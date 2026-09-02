import { REDIS_KEYS } from "@market-sentinel/contracts";
import { auditLogs, candles, marketRegimes, pivots, priceZones, type Database } from "@market-sentinel/db";
import { TIMEFRAME_MS, TIMEFRAMES, type Location, type Timeframe } from "@market-sentinel/domain";
import { atrWilderSeries } from "@market-sentinel/indicators";
import {
  applyZoneBreaks,
  classifyRegime,
  classifySwings,
  clusterAutoZones,
  detectConfirmedPivots,
  expireIdleZones,
  mergeAutoZones,
  mergePriorZones,
  nearestZone,
  priorPeriodZones,
  reactionAfterTouch,
  scoreZoneStrength,
  zonesOverlap,
  type PriceZone,
} from "@market-sentinel/market-structure";
import { and, desc, eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { maybeAlertMajorLevel, maybeAlertZoneTransitions, type TelegramCredentials } from "./alert-store.js";
import type { InstrumentRef } from "./candle-store.js";

const STRUCTURE_LOOKBACK = 500;

export async function evaluateStructure(args: {
  db: Database;
  redis: Redis;
  instrument: InstrumentRef;
  timeframe: Timeframe;
  now?: Date;
  streamGate?: "live" | "historical";
  telegram?: TelegramCredentials;
}): Promise<void> {
  const now = args.now ?? new Date();
  const rows = await args.db
    .select()
    .from(candles)
    .where(
      and(eq(candles.instrumentId, args.instrument.id), eq(candles.timeframe, args.timeframe), eq(candles.isFinal, true)),
    )
    .orderBy(desc(candles.openTimeUtc))
    .limit(STRUCTURE_LOOKBACK);
  const finals = rows.slice().reverse();
  if (finals.length === 0) {
    return;
  }
  const bars = finals.map((row) => ({
    instrumentId: row.instrumentId,
    timeframe: args.timeframe,
    openTimeUtc: row.openTimeUtc,
    high: row.high,
    low: row.low,
    open: row.open,
    close: row.close,
    isFinal: row.isFinal,
  }));
  const confirmed = detectConfirmedPivots({ candles: bars });
  for (const pivot of confirmed) {
    await args.db
      .insert(pivots)
      .values({
        id: randomUUID(),
        instrumentId: pivot.instrumentId,
        timeframe: pivot.timeframe,
        openTimeUtc: pivot.openTimeUtc,
        type: pivot.type,
        price: pivot.price,
        leftBars: pivot.leftBars,
        rightBars: pivot.rightBars,
      })
      .onConflictDoNothing({
        target: [pivots.instrumentId, pivots.timeframe, pivots.openTimeUtc, pivots.type],
      });
  }

  const atrValues = atrWilderSeries({ bars: bars.map((bar) => ({ open: bar.open, high: bar.high, low: bar.low, close: bar.close })) });
  const atr = atrValues[atrValues.length - 1]?.toString() ?? null;
  const existingRows = await args.db.select().from(priceZones).where(eq(priceZones.instrumentId, args.instrument.id));
  const existing = existingRows.map(rowToZone);
  const manuals = existing.filter((zone) => zone.source === "USER_MANUAL");
  const autoIncoming = clusterAutoZones({
    pivots: confirmed,
    atr,
    existingManual: manuals,
    instrumentId: args.instrument.id,
    timeframe: args.timeframe,
  });
  const priorIncoming = priorPeriodZones({
    candles: bars,
    instrumentId: args.instrument.id,
    timeframe: args.timeframe,
    now,
  });
  const thisTf = existing.filter((zone) => zone.timeframe === args.timeframe);
  const otherTf = existing.filter((zone) => zone.timeframe !== args.timeframe);
  const last = bars[bars.length - 1];
  if (!last) {
    return;
  }
  const merged = expireIdleZones({
    zones: applyZoneBreaks({
      zones: [
        ...mergeAutoZones({
          existing: thisTf.filter((zone) => zone.source === "AUTO_PIVOT" || zone.source === "USER_MANUAL"),
          incoming: autoIncoming,
        }),
        ...mergePriorZones({
          existing: thisTf.filter((zone) => zone.source === "PRIOR_DAY" || zone.source === "PRIOR_WEEK"),
          incoming: priorIncoming,
        }),
      ],
      candles: bars,
      atr,
    }),
    lastOpenTime: last.openTimeUtc,
    barMs: TIMEFRAME_MS[args.timeframe],
  }).map((zone) => ({
    ...zone,
    strengthScore: scoreZoneStrength({
      zone,
      multiTimeframe: otherTf.some((other) => other.status === "ACTIVE" && zonesOverlap({ left: zone, right: other })),
      lastBarOpen: last.openTimeUtc,
      barMs: TIMEFRAME_MS[args.timeframe],
      reactionAtr: reactionAfterTouch({ zone, candles: bars, atr }),
    }),
  }));

  await persistZones({
    db: args.db,
    timeframe: args.timeframe,
    instrumentId: args.instrument.id,
    next: merged,
  });

  const previousLocation = (
    await args.db
      .select()
      .from(marketRegimes)
      .where(and(eq(marketRegimes.instrumentId, args.instrument.id), eq(marketRegimes.timeframe, args.timeframe)))
      .orderBy(desc(marketRegimes.timestamp))
      .limit(1)
  )[0]?.location as Location | undefined;

  const swings = classifySwings({ pivots: confirmed, atr });
  const allZones = [...otherTf, ...merged];
  const regime = classifyRegime({
    instrumentId: args.instrument.id,
    timeframe: args.timeframe,
    timestamp: last.openTimeUtc,
    swings,
    atrSeries: atrValues.map((value) => value?.toString() ?? null),
    close: last.close,
    zones: allZones,
  });
  await args.db
    .insert(marketRegimes)
    .values({
      id: randomUUID(),
      instrumentId: regime.instrumentId,
      timeframe: regime.timeframe,
      timestamp: regime.timestamp,
      trend: regime.trend,
      structure: regime.structure,
      volatility: regime.volatility,
      location: regime.location,
      confidence: regime.confidence,
      evidenceJson: regime.evidenceJson,
    })
    .onConflictDoUpdate({
      target: [marketRegimes.instrumentId, marketRegimes.timeframe, marketRegimes.timestamp],
      set: {
        trend: regime.trend,
        structure: regime.structure,
        volatility: regime.volatility,
        location: regime.location,
        confidence: regime.confidence,
        evidenceJson: regime.evidenceJson,
      },
    });

  await cacheStructure({
    db: args.db,
    redis: args.redis,
    instrument: args.instrument,
  });
  await args.db.insert(auditLogs).values({
    id: randomUUID(),
    eventType: "REGIME_UPDATED",
    instrumentId: args.instrument.id,
    payloadJson: { timeframe: args.timeframe, trend: regime.trend, structure: regime.structure },
  });
  await args.db.insert(auditLogs).values({
    id: randomUUID(),
    eventType: "ZONE_UPDATED",
    instrumentId: args.instrument.id,
    payloadJson: { timeframe: args.timeframe, count: merged.length },
  });

  const context = {
    db: args.db,
    redis: args.redis,
    streamGate: args.streamGate ?? "live",
    telegram: args.telegram,
    now,
  };
  await maybeAlertZoneTransitions({
    context,
    instrument: args.instrument,
    previous: thisTf,
    next: merged,
  });
  const close = last.close;
  const atrForNear = atr;
  const supportOrResistance =
    regime.location === "AT_SUPPORT" || regime.location === "AT_RESISTANCE"
      ? nearestZone({
          price: close,
          zones: allZones,
          atr: atrForNear,
          type: regime.location === "AT_SUPPORT" ? "SUPPORT" : "RESISTANCE",
        })
      : null;
  await maybeAlertMajorLevel({
    context,
    instrument: args.instrument,
    previousLocation: previousLocation ?? null,
    nextLocation: regime.location,
    nearestZone: supportOrResistance?.zone ?? null,
    evaluatedOpenTimeUtc: last.openTimeUtc,
  });
}

export async function evaluateInstrumentStructure(args: {
  db: Database;
  redis: Redis;
  instrument: InstrumentRef;
  streamGate?: "live" | "historical";
  telegram?: TelegramCredentials;
}): Promise<void> {
  for (const timeframe of TIMEFRAMES) {
    await evaluateStructure({
      db: args.db,
      redis: args.redis,
      instrument: args.instrument,
      timeframe,
      streamGate: args.streamGate,
      telegram: args.telegram,
    });
  }
}

async function persistZones(args: {
  db: Database;
  timeframe: Timeframe;
  instrumentId: string;
  next: PriceZone[];
}): Promise<void> {
  await args.db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(priceZones)
      .where(and(eq(priceZones.instrumentId, args.instrumentId), eq(priceZones.timeframe, args.timeframe)));
    const keepIds = new Set(args.next.map((zone) => zone.id).filter((id): id is string => Boolean(id)));
    for (const zone of args.next) {
      const values = {
        instrumentId: zone.instrumentId,
        timeframe: zone.timeframe,
        type: zone.type,
        source: zone.source,
        lowerBound: zone.lowerBound,
        upperBound: zone.upperBound,
        midpoint: zone.midpoint,
        strengthScore: zone.strengthScore,
        touchCount: zone.touchCount,
        lastTouchedAt: zone.lastTouchedAt,
        status: zone.status,
        metadataJson: zone.metadataJson,
        updatedAt: new Date(),
      };
      if (zone.id) {
        await tx.update(priceZones).set(values).where(eq(priceZones.id, zone.id));
      } else {
        const id = randomUUID();
        keepIds.add(id);
        await tx.insert(priceZones).values({ id, ...values });
      }
    }
    for (const row of existingRows) {
      if (row.source === "USER_MANUAL" || keepIds.has(row.id)) {
        continue;
      }
      if (row.source === "AUTO_PIVOT" && (row.status === "BROKEN" || row.status === "FLIPPED")) {
        continue;
      }
      await tx
        .update(priceZones)
        .set({ status: "EXPIRED", updatedAt: new Date() })
        .where(eq(priceZones.id, row.id));
    }
  });
}

async function cacheStructure(args: { db: Database; redis: Redis; instrument: InstrumentRef }): Promise<void> {
  const regimeMap: Record<string, unknown> = {};
  for (const timeframe of TIMEFRAMES) {
    const rows = await args.db
      .select()
      .from(marketRegimes)
      .where(and(eq(marketRegimes.instrumentId, args.instrument.id), eq(marketRegimes.timeframe, timeframe)))
      .orderBy(desc(marketRegimes.timestamp))
      .limit(1);
    const row = rows[0];
    if (row) {
      regimeMap[timeframe] = {
        instrumentId: row.instrumentId,
        timeframe,
        timestamp: row.timestamp.toISOString(),
        trend: row.trend,
        structure: row.structure,
        volatility: row.volatility,
        location: row.location,
        confidence: row.confidence,
        evidenceJson: row.evidenceJson ?? {},
      };
    }
  }
  const zoneRows = await args.db.select().from(priceZones).where(eq(priceZones.instrumentId, args.instrument.id));
  await args.redis.set(REDIS_KEYS.regime(args.instrument.symbol), JSON.stringify(regimeMap));
  await args.redis.set(
    REDIS_KEYS.zones(args.instrument.symbol),
    JSON.stringify(
      zoneRows.map((row) => ({
        id: row.id,
        instrumentId: row.instrumentId,
        symbol: args.instrument.symbol,
        timeframe: row.timeframe,
        type: row.type,
        source: row.source,
        lowerBound: row.lowerBound,
        upperBound: row.upperBound,
        midpoint: row.midpoint,
        strengthScore: row.strengthScore,
        touchCount: row.touchCount,
        lastTouchedAt: row.lastTouchedAt?.toISOString() ?? null,
        status: row.status,
        metadataJson: row.metadataJson ?? {},
      })),
    ),
  );
}

function rowToZone(row: typeof priceZones.$inferSelect): PriceZone {
  return {
    id: row.id,
    instrumentId: row.instrumentId,
    timeframe: row.timeframe as Timeframe,
    type: row.type as PriceZone["type"],
    source: row.source as PriceZone["source"],
    lowerBound: row.lowerBound,
    upperBound: row.upperBound,
    midpoint: row.midpoint,
    strengthScore: row.strengthScore,
    touchCount: row.touchCount,
    lastTouchedAt: row.lastTouchedAt,
    status: row.status as PriceZone["status"],
    metadataJson: (row.metadataJson as Record<string, unknown>) ?? {},
  };
}
