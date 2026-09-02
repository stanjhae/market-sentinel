import { REDIS_KEYS } from "@market-sentinel/contracts";
import { auditLogs, candles, indicatorSnapshots, marketRegimes, priceZones, signals, type Database } from "@market-sentinel/db";
import {
  TIMEFRAME_MS,
  TIMEFRAMES,
  type SignalDirection,
  type SignalState,
  type StreamFreshness,
  type StrategyKey,
  type Timeframe,
} from "@market-sentinel/domain";
import { buildMultiTimeframeContext, type MarketRegime, type PriceZone, type StructureBar } from "@market-sentinel/market-structure";
import {
  applySignalTransition,
  bestOpenTradeSetup,
  emptyEvaluation,
  evaluateAllStrategies,
  type SignalRecord,
  type StrategyIndicators,
  type StrategySnapshot,
} from "@market-sentinel/strategies";
import { createLogger } from "@market-sentinel/observability";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { readScoreRisk } from "./account-store.js";
import {
  maybeAlertScoreCross,
  maybeAlertSignalTransition,
  publishSignalChanged,
  readCachedScore,
  type TelegramCredentials,
} from "./alert-store.js";
import type { InstrumentRef } from "./candle-store.js";

const logger = createLogger("worker-signals");

const BAR_LOOKBACK = 80;
const OPEN_STATES = ["DETECTED", "WATCHING", "CONFIRMED", "TRADE_PLANNED", "ENTERED"] as const;

export type SignalSummary = {
  opportunityScore: number | null;
  opportunityLabel: string | null;
  signalState: SignalState | null;
  signalExplanation: string | null;
  entryStatus: string | null;
};

export function barsElapsed15m(args: { from: Date; to: Date }): number {
  return Math.max(0, Math.floor((args.to.getTime() - args.from.getTime()) / TIMEFRAME_MS["15m"]));
}

export function rowToSignal(args: { row: typeof signals.$inferSelect }): SignalRecord {
  return {
    id: args.row.id,
    instrumentId: args.row.instrumentId,
    symbol: args.row.symbol,
    strategyKey: args.row.strategyKey as StrategyKey,
    strategyVersion: args.row.strategyVersion,
    direction: args.row.direction as SignalDirection,
    state: args.row.state as SignalState,
    triggerTimeframe: args.row.triggerTimeframe as Timeframe,
    detectedAt: args.row.detectedAt,
    watchingAt: args.row.watchingAt,
    confirmedAt: args.row.confirmedAt,
    tradePlannedAt: args.row.tradePlannedAt,
    invalidatedAt: args.row.invalidatedAt,
    expiredAt: args.row.expiredAt,
    dismissedAt: args.row.dismissedAt,
    score: args.row.score,
    confidenceLabel: args.row.confidenceLabel as SignalRecord["confidenceLabel"],
    entryZoneLow: args.row.entryZoneLow,
    entryZoneHigh: args.row.entryZoneHigh,
    invalidationPrice: args.row.invalidationPrice,
    target1: args.row.target1,
    target2: args.row.target2,
    target3: args.row.target3,
    riskRewardToT1: args.row.riskRewardToT1,
    riskRewardToT2: args.row.riskRewardToT2,
    lastEvaluatedOpenTimeUtc: args.row.lastEvaluatedOpenTimeUtc,
    evidenceJson: (args.row.evidenceJson as Record<string, unknown>) ?? {},
    snapshotJson: (args.row.snapshotJson as Record<string, unknown>) ?? {},
  };
}

export async function evaluateSignals(args: {
  db: Database;
  redis: Redis;
  instrument: InstrumentRef;
  staleAfterMs?: number;
  now?: Date;
  streamGate?: "live" | "historical";
  telegram?: TelegramCredentials;
}): Promise<void> {
  const snapshot = await loadStrategySnapshot({
    db: args.db,
    redis: args.redis,
    instrument: args.instrument,
    staleAfterMs: args.staleAfterMs ?? 15_000,
    now: args.now ?? new Date(),
    streamGate: args.streamGate ?? "live",
  });
  if (!snapshot) {
    return;
  }
  const previousScore = await readCachedScore({ redis: args.redis, symbol: args.instrument.symbol });
  const risk = await readScoreRisk({ redis: args.redis });
  const evaluations = evaluateAllStrategies({ snapshot });
  const openRows = await args.db
    .select()
    .from(signals)
    .where(and(eq(signals.instrumentId, args.instrument.id), inArray(signals.state, [...OPEN_STATES])));
  const openByKey = new Map(openRows.map((row) => [`${row.strategyKey}:${row.direction}`, row]));
  const processed = new Set<string>();
  for (const evaluation of evaluations) {
    processed.add(`${evaluation.strategyKey}:${evaluation.direction}`);
    await applyAndPersist({
      db: args.db,
      redis: args.redis,
      instrument: args.instrument,
      snapshot,
      evaluation,
      current: openByKey.get(`${evaluation.strategyKey}:${evaluation.direction}`) ?? null,
      streamGate: args.streamGate ?? "live",
      telegram: args.telegram,
      risk,
    });
  }
  for (const row of openRows) {
    const key = `${row.strategyKey}:${row.direction}`;
    if (processed.has(key)) {
      continue;
    }
    await applyAndPersist({
      db: args.db,
      redis: args.redis,
      instrument: args.instrument,
      snapshot,
      evaluation: emptyEvaluation({
        strategyKey: row.strategyKey as StrategyKey,
        snapshot,
        direction: row.direction as SignalDirection,
        evidence: { reason: "missing-direction" },
      }),
      current: row,
      streamGate: args.streamGate ?? "live",
      telegram: args.telegram,
      risk,
    });
  }
  await cacheSignalSummary({ db: args.db, redis: args.redis, instrument: args.instrument });
  const nextScore = await readCachedScore({ redis: args.redis, symbol: args.instrument.symbol });
  const bestRows = await args.db
    .select()
    .from(signals)
    .where(and(eq(signals.instrumentId, args.instrument.id), inArray(signals.state, [...OPEN_STATES])));
  const best = bestOpenTradeSetup({ records: bestRows });
  await maybeAlertScoreCross({
    context: {
      db: args.db,
      redis: args.redis,
      streamGate: args.streamGate ?? "live",
      telegram: args.telegram,
      now: args.now,
    },
    instrument: args.instrument,
    previousScore,
    nextScore,
    record: best ? rowToSignal({ row: best }) : null,
    evaluatedOpenTimeUtc: snapshot.lastFinalOpenTimeUtc,
  });
}

async function applyAndPersist(args: {
  db: Database;
  redis: Redis;
  instrument: InstrumentRef;
  snapshot: StrategySnapshot;
  evaluation: ReturnType<typeof evaluateAllStrategies>[number];
  current: typeof signals.$inferSelect | null;
  streamGate: "live" | "historical";
  telegram?: TelegramCredentials;
  risk?: { dailyLossHit?: boolean; consecutiveLossHit?: boolean; cooldownActive?: boolean; newsBlackout?: boolean };
}): Promise<void> {
  const current = args.current ? rowToSignal({ row: args.current }) : null;
  const lastProgress = current?.watchingAt ?? current?.confirmedAt ?? current?.detectedAt ?? args.snapshot.lastFinalOpenTimeUtc;
  const result = applySignalTransition({
    current,
    evaluation: args.evaluation,
    snapshot: args.snapshot,
    now: args.snapshot.evaluatedAt,
    barsElapsed15m: barsElapsed15m({ from: lastProgress, to: args.snapshot.lastFinalOpenTimeUtc }),
    idFactory: () => randomUUID(),
    symbol: args.instrument.symbol,
    risk: args.risk,
  });
  if (!result.next) {
    return;
  }
  try {
    await persistSignal({ db: args.db, record: result.next });
    if (result.changed) {
      if (result.event) {
        await args.db.insert(auditLogs).values({
          id: randomUUID(),
          eventType: result.event,
          instrumentId: args.instrument.id,
          payloadJson: {
            signalId: result.next.id,
            strategyKey: result.next.strategyKey,
            state: result.next.state,
            direction: result.next.direction,
          },
        });
      }
      await publishSignalChanged({ redis: args.redis, record: result.next });
      await maybeAlertSignalTransition({
        context: {
          db: args.db,
          redis: args.redis,
          streamGate: args.streamGate,
          telegram: args.telegram,
          now: args.snapshot.evaluatedAt,
        },
        instrument: args.instrument,
        previousState: current?.state ?? null,
        next: result.next,
      });
    }
  } catch (error) {
    logger.warn({ err: error, symbol: args.instrument.symbol, strategyKey: args.evaluation.strategyKey }, "signal persist skipped");
  }
}

export async function cacheSignalSummary(args: {
  db: Database;
  redis: Redis;
  instrument: InstrumentRef;
}): Promise<void> {
  const rows = await args.db
    .select()
    .from(signals)
    .where(and(eq(signals.instrumentId, args.instrument.id), inArray(signals.state, [...OPEN_STATES])));
  const best = bestOpenTradeSetup({ records: rows });
  const summary: SignalSummary = best
    ? {
        opportunityScore: best.score,
        opportunityLabel: best.confidenceLabel,
        signalState: best.state as SignalState,
        signalExplanation: explanationFrom({ row: best }),
        entryStatus: best.state === "WATCHING" ? "WAITING FOR CONFIRMATION" : best.state,
      }
    : {
        opportunityScore: null,
        opportunityLabel: null,
        signalState: null,
        signalExplanation: null,
        entryStatus: null,
      };
  await args.redis.set(REDIS_KEYS.signals(args.instrument.symbol), JSON.stringify(summary));
}

function explanationFrom(args: { row: typeof signals.$inferSelect }): string {
  const evidence = (args.row.evidenceJson as Record<string, unknown> | null) ?? {};
  const reason = typeof evidence.reason === "string" ? evidence.reason : args.row.state.toLowerCase();
  return `${args.row.strategyKey} ${args.row.direction.toLowerCase()} · ${reason}`;
}

async function persistSignal(args: { db: Database; record: SignalRecord }): Promise<void> {
  const values = {
    instrumentId: args.record.instrumentId,
    symbol: args.record.symbol,
    strategyKey: args.record.strategyKey,
    strategyVersion: args.record.strategyVersion,
    direction: args.record.direction,
    state: args.record.state,
    triggerTimeframe: args.record.triggerTimeframe,
    detectedAt: args.record.detectedAt,
    watchingAt: args.record.watchingAt,
    confirmedAt: args.record.confirmedAt,
    tradePlannedAt: args.record.tradePlannedAt,
    invalidatedAt: args.record.invalidatedAt,
    expiredAt: args.record.expiredAt,
    dismissedAt: args.record.dismissedAt,
    score: args.record.score,
    confidenceLabel: args.record.confidenceLabel,
    entryZoneLow: args.record.entryZoneLow,
    entryZoneHigh: args.record.entryZoneHigh,
    invalidationPrice: args.record.invalidationPrice,
    target1: args.record.target1,
    target2: args.record.target2,
    target3: args.record.target3,
    riskRewardToT1: args.record.riskRewardToT1,
    riskRewardToT2: args.record.riskRewardToT2,
    lastEvaluatedOpenTimeUtc: args.record.lastEvaluatedOpenTimeUtc,
    evidenceJson: args.record.evidenceJson,
    snapshotJson: args.record.snapshotJson,
    updatedAt: new Date(),
  };
  try {
    await args.db
      .insert(signals)
      .values({ id: args.record.id, ...values })
      .onConflictDoUpdate({
        target: signals.id,
        set: values,
      });
  } catch (error) {
    if (!isUniqueViolation({ error })) {
      throw error;
    }
    const existing = await args.db
      .select()
      .from(signals)
      .where(
        and(
          eq(signals.instrumentId, args.record.instrumentId),
          eq(signals.strategyKey, args.record.strategyKey),
          eq(signals.direction, args.record.direction),
          inArray(signals.state, [...OPEN_STATES]),
        ),
      )
      .limit(1);
    const row = existing[0];
    if (!row) {
      throw error;
    }
    await args.db.update(signals).set(values).where(eq(signals.id, row.id));
  }
}

export function isUniqueViolation(args: { error: unknown }): boolean {
  return readErrorCode({ error: args.error }) === "23505";
}

export function readErrorCode(args: { error: unknown }): string | null {
  if (typeof args.error !== "object" || args.error === null) {
    return null;
  }
  if ("code" in args.error && typeof args.error.code === "string") {
    return args.error.code;
  }
  if ("cause" in args.error) {
    return readErrorCode({ error: args.error.cause });
  }
  return null;
}

async function loadStrategySnapshot(args: {
  db: Database;
  redis: Redis;
  instrument: InstrumentRef;
  staleAfterMs: number;
  now: Date;
  streamGate: "live" | "historical";
}): Promise<StrategySnapshot | null> {
  const lastBars: Partial<Record<Timeframe, StructureBar[]>> = {};
  const indicators: Partial<Record<Timeframe, StrategyIndicators>> = {};
  const regimes: Partial<Record<Timeframe, MarketRegime | null>> = {};
  let previousStructure1h: MarketRegime["structure"] | null = null;
  let previousRsi14: string | null = null;
  for (const timeframe of TIMEFRAMES) {
    const rows = await args.db
      .select()
      .from(candles)
      .where(and(eq(candles.instrumentId, args.instrument.id), eq(candles.timeframe, timeframe), eq(candles.isFinal, true)))
      .orderBy(desc(candles.openTimeUtc))
      .limit(BAR_LOOKBACK);
    lastBars[timeframe] = rows
      .slice()
      .reverse()
      .map((row) => ({
        instrumentId: row.instrumentId,
        timeframe,
        openTimeUtc: row.openTimeUtc,
        high: row.high,
        low: row.low,
        open: row.open,
        close: row.close,
        isFinal: row.isFinal,
      }));
    const snaps = await args.db
      .select()
      .from(indicatorSnapshots)
      .where(and(eq(indicatorSnapshots.instrumentId, args.instrument.id), eq(indicatorSnapshots.timeframe, timeframe)))
      .orderBy(desc(indicatorSnapshots.candleOpenTime))
      .limit(2);
    const latest = snaps[0];
    if (latest) {
      indicators[timeframe] = {
        rsi14: latest.rsi14,
        previousRsi14: snaps[1]?.rsi14 ?? null,
        atr14: latest.atr14,
        ema20: latest.ema20,
        ema50: latest.ema50,
        bbBasis20: latest.bbBasis20,
        bbUpper20x2: latest.bbUpper20x2,
        bbLower20x2: latest.bbLower20x2,
        trueRange: latest.trueRange,
      };
    }
    if (timeframe === "15m") {
      previousRsi14 = snaps[1]?.rsi14 ?? null;
    }
    const regimeRows = await args.db
      .select()
      .from(marketRegimes)
      .where(and(eq(marketRegimes.instrumentId, args.instrument.id), eq(marketRegimes.timeframe, timeframe)))
      .orderBy(desc(marketRegimes.timestamp))
      .limit(2);
    const latestRegime = regimeRows[0];
    regimes[timeframe] = latestRegime
      ? {
          instrumentId: latestRegime.instrumentId,
          timeframe,
          timestamp: latestRegime.timestamp,
          trend: latestRegime.trend as MarketRegime["trend"],
          structure: latestRegime.structure as MarketRegime["structure"],
          volatility: latestRegime.volatility as MarketRegime["volatility"],
          location: latestRegime.location as MarketRegime["location"],
          confidence: latestRegime.confidence,
          evidenceJson: (latestRegime.evidenceJson as Record<string, unknown>) ?? {},
        }
      : null;
    if (timeframe === "1h") {
      previousStructure1h = (regimeRows[1]?.structure as MarketRegime["structure"] | undefined) ?? null;
    }
  }
  const last15 = lastBars["15m"]?.[lastBars["15m"].length - 1];
  if (!last15) {
    return null;
  }
  const zoneRows = await args.db.select().from(priceZones).where(eq(priceZones.instrumentId, args.instrument.id));
  const zones: PriceZone[] = zoneRows.map((row) => ({
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
  }));
  const multiTimeframe = buildMultiTimeframeContext({
    regimes,
    zones,
    bars15m: lastBars["15m"]?.slice(-3) ?? [],
    indicators15m: {
      rsi14: indicators["15m"]?.rsi14 ?? null,
      previousRsi14,
      atr14: indicators["15m"]?.atr14 ?? null,
      bbBasis20: indicators["15m"]?.bbBasis20 ?? null,
      bbUpper20x2: indicators["15m"]?.bbUpper20x2 ?? null,
      bbLower20x2: indicators["15m"]?.bbLower20x2 ?? null,
    },
    close1h: lastBars["1h"]?.[lastBars["1h"].length - 1]?.close ?? null,
    atr1h: indicators["1h"]?.atr14 ?? null,
    previousStructure1h,
  });
  return {
    instrumentId: args.instrument.id,
    evaluatedAt: args.now,
    lastFinalClose: last15.close,
    lastFinalOpenTimeUtc: last15.openTimeUtc,
    triggerTimeframe: "15m",
    streamFreshness:
      args.streamGate === "historical"
        ? "LIVE"
        : await readFreshness({ redis: args.redis, staleAfterMs: args.staleAfterMs }),
    multiTimeframe,
    regimes,
    zones,
    indicators,
    lastBars,
  };
}

async function readFreshness(args: { redis: Redis; staleAfterMs: number }): Promise<StreamFreshness> {
  const raw = await args.redis.get(REDIS_KEYS.stream);
  if (!raw) {
    return "DISCONNECTED";
  }
  const stream = JSON.parse(raw) as { streamStatus?: StreamFreshness; lastQuoteAt?: string | null };
  if (!stream.lastQuoteAt) {
    return stream.streamStatus ?? "DISCONNECTED";
  }
  if (Date.now() - Date.parse(stream.lastQuoteAt) > args.staleAfterMs) {
    return "STALE";
  }
  return stream.streamStatus ?? "LIVE";
}

export function bestOpenSignal(args: { records: SignalRecord[] }): SignalRecord | null {
  return bestOpenTradeSetup({ records: args.records });
}
