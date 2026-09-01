import { REDIS_KEYS } from "@market-sentinel/contracts";
import { candles, indicatorSnapshots, type Database } from "@market-sentinel/db";
import { TIMEFRAMES, type CanonicalSymbol, type Timeframe } from "@market-sentinel/domain";
import {
  CandleBuilder,
  candleCloseTimeUtc,
  candleOpenTimeUtc,
  decideCandleWrite,
  isCandleOpen,
  type Candle,
} from "@market-sentinel/domain/candle";
import {
  ETORO_CANDLE_INTERVAL,
  type EtoroRestClient,
  type NormalizedHistoryCandle,
} from "@market-sentinel/etoro-client";
import { computeIndicatorSnapshot } from "@market-sentinel/indicators";
import { and, desc, eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";

export const BACKFILL_CANDLE_COUNT = 500;
export const RECONCILE_CANDLE_COUNT = 20;
const EMA200_PERIOD = 200;
const RSI_PERIOD = 14;
const RSI_WARMUP_BARS = RSI_PERIOD;
export const INDICATOR_LOOKBACK = EMA200_PERIOD + RSI_PERIOD + RSI_WARMUP_BARS;

export type InstrumentRef = {
  id: string;
  symbol: CanonicalSymbol;
  etoroInstrumentId: number;
};

export function toCandleDto(args: { candle: Candle; symbol: string }) {
  return {
    instrumentId: args.candle.instrumentId,
    symbol: args.symbol,
    timeframe: args.candle.timeframe,
    openTimeUtc: args.candle.openTimeUtc.toISOString(),
    closeTimeUtc: args.candle.closeTimeUtc.toISOString(),
    open: args.candle.open,
    high: args.candle.high,
    low: args.candle.low,
    close: args.candle.close,
    volume: args.candle.volume,
    source: args.candle.source,
    isFinal: args.candle.isFinal,
    revision: args.candle.revision,
  };
}

export function historyToCandle(args: {
  history: NormalizedHistoryCandle;
  instrumentId: string;
  timeframe: Timeframe;
  now: Date;
}): Candle {
  const openTimeUtc = candleOpenTimeUtc({
    at: new Date(args.history.fromDate),
    timeframe: args.timeframe,
  });
  const closeTimeUtc = candleCloseTimeUtc({ openTimeUtc, timeframe: args.timeframe });
  return {
    instrumentId: args.instrumentId,
    timeframe: args.timeframe,
    openTimeUtc,
    closeTimeUtc,
    open: args.history.open,
    high: args.history.high,
    low: args.history.low,
    close: args.history.close,
    volume: args.history.volume,
    source: "ETORO_REST",
    isFinal: !isCandleOpen({ closeTimeUtc, now: args.now }),
    revision: 0,
  };
}

export async function upsertCandle(args: {
  db: Database;
  redis: Redis;
  symbol: CanonicalSymbol;
  incoming: Candle;
}): Promise<{ action: "insert" | "update" | "revise" | "ignore"; candle: Candle }> {
  const existingRows = await args.db
    .select()
    .from(candles)
    .where(
      and(
        eq(candles.instrumentId, args.incoming.instrumentId),
        eq(candles.timeframe, args.incoming.timeframe),
        eq(candles.openTimeUtc, args.incoming.openTimeUtc),
      ),
    )
    .limit(1);
  const existingRow = existingRows[0];
  const existing = existingRow ? rowToCandle(existingRow) : null;
  const decision = decideCandleWrite({ existing, incoming: args.incoming });
  const next: Candle = { ...args.incoming, revision: decision.revision };

  if (decision.action === "insert") {
    await args.db.insert(candles).values({
      id: randomUUID(),
      instrumentId: next.instrumentId,
      timeframe: next.timeframe,
      openTimeUtc: next.openTimeUtc,
      closeTimeUtc: next.closeTimeUtc,
      open: next.open,
      high: next.high,
      low: next.low,
      close: next.close,
      volume: next.volume,
      source: next.source,
      isFinal: next.isFinal,
      revision: next.revision,
    });
  } else if (decision.action === "update" || decision.action === "revise") {
    await args.db
      .update(candles)
      .set({
        closeTimeUtc: next.closeTimeUtc,
        open: next.open,
        high: next.high,
        low: next.low,
        close: next.close,
        volume: next.volume,
        source: next.source,
        isFinal: next.isFinal,
        revision: next.revision,
      })
      .where(
        and(
          eq(candles.instrumentId, next.instrumentId),
          eq(candles.timeframe, next.timeframe),
          eq(candles.openTimeUtc, next.openTimeUtc),
        ),
      );
  }

  const stored = decision.action === "ignore" && existing ? existing : next;
  if (decision.action !== "ignore") {
    await cacheLatestCandle({
      redis: args.redis,
      symbol: args.symbol,
      candle: stored,
    });
    await args.redis.publish(
      REDIS_KEYS.candlesChannel,
      JSON.stringify({
        type: stored.isFinal ? "CANDLE_CLOSED" : "CANDLE_UPDATED",
        candle: toCandleDto({ candle: stored, symbol: args.symbol }),
      }),
    );
  }

  return { action: decision.action, candle: stored };
}

async function cacheLatestCandle(args: { redis: Redis; symbol: CanonicalSymbol; candle: Candle }) {
  const key = REDIS_KEYS.candle(args.symbol, args.candle.timeframe);
  const raw = await args.redis.get(key);
  const cached = raw ? (JSON.parse(raw) as { openTimeUtc?: string }) : null;
  if (cached?.openTimeUtc && Date.parse(cached.openTimeUtc) > args.candle.openTimeUtc.getTime()) {
    return;
  }
  await args.redis.set(key, JSON.stringify(toCandleDto({ candle: args.candle, symbol: args.symbol })));
}

export async function persistIndicatorSnapshot(args: {
  db: Database;
  redis: Redis;
  symbol: CanonicalSymbol;
  instrumentId: string;
  timeframe: Timeframe;
}): Promise<void> {
  const rows = await args.db
    .select()
    .from(candles)
    .where(and(eq(candles.instrumentId, args.instrumentId), eq(candles.timeframe, args.timeframe), eq(candles.isFinal, true)))
    .orderBy(desc(candles.openTimeUtc))
    .limit(INDICATOR_LOOKBACK);
  const bars = rows
    .slice()
    .reverse()
    .map((row) => ({ open: row.open, high: row.high, low: row.low, close: row.close }));
  const last = rows[0];
  if (!last) {
    return;
  }
  const values = computeIndicatorSnapshot({ bars });
  const snapshot = {
    instrumentId: args.instrumentId,
    timeframe: args.timeframe,
    candleOpenTime: last.openTimeUtc.toISOString(),
    ...values,
  };
  await args.db
    .insert(indicatorSnapshots)
    .values({
      id: randomUUID(),
      instrumentId: args.instrumentId,
      timeframe: args.timeframe,
      candleOpenTime: last.openTimeUtc,
      rsi14: values.rsi14,
      atr14: values.atr14,
      ema20: values.ema20,
      ema50: values.ema50,
      ema200: values.ema200,
      bbBasis20: values.bbBasis20,
      bbUpper20x2: values.bbUpper20x2,
      bbLower20x2: values.bbLower20x2,
      bbWidth: values.bbWidth,
      trueRange: values.trueRange,
      rollingVolatility: values.rollingVolatility,
    })
    .onConflictDoUpdate({
      target: [indicatorSnapshots.instrumentId, indicatorSnapshots.timeframe, indicatorSnapshots.candleOpenTime],
      set: {
        rsi14: values.rsi14,
        atr14: values.atr14,
        ema20: values.ema20,
        ema50: values.ema50,
        ema200: values.ema200,
        bbBasis20: values.bbBasis20,
        bbUpper20x2: values.bbUpper20x2,
        bbLower20x2: values.bbLower20x2,
        bbWidth: values.bbWidth,
        trueRange: values.trueRange,
        rollingVolatility: values.rollingVolatility,
      },
    });
  await args.redis.set(REDIS_KEYS.indicators(args.symbol, args.timeframe), JSON.stringify(snapshot));
}

export async function backfillInstrument(args: {
  db: Database;
  redis: Redis;
  rest: EtoroRestClient;
  instrument: InstrumentRef;
  now?: Date;
}): Promise<Map<Timeframe, CandleBuilder>> {
  const builders = new Map<Timeframe, CandleBuilder>();
  const now = args.now ?? new Date();
  for (const timeframe of TIMEFRAMES) {
    const builder = new CandleBuilder({ instrumentId: args.instrument.id, timeframe });
    const { candles: history } = await args.rest.getInstrumentCandles({
      instrumentId: args.instrument.etoroInstrumentId,
      direction: "desc",
      interval: ETORO_CANDLE_INTERVAL[timeframe],
      candlesCount: BACKFILL_CANDLE_COUNT,
    });
    for (const item of history) {
      const incoming = historyToCandle({
        history: item,
        instrumentId: args.instrument.id,
        timeframe,
        now,
      });
      await upsertCandle({
        db: args.db,
        redis: args.redis,
        symbol: args.instrument.symbol,
        incoming,
      });
      if (!incoming.isFinal) {
        builder.seed({ candle: incoming });
      }
    }
    await persistIndicatorSnapshot({
      db: args.db,
      redis: args.redis,
      symbol: args.instrument.symbol,
      instrumentId: args.instrument.id,
      timeframe,
    });
    builders.set(timeframe, builder);
  }
  return builders;
}

export async function reconcileInstrument(args: {
  db: Database;
  redis: Redis;
  rest: EtoroRestClient;
  instrument: InstrumentRef;
  now?: Date;
}): Promise<number> {
  const now = args.now ?? new Date();
  let revisions = 0;
  for (const timeframe of TIMEFRAMES) {
    const { candles: history } = await args.rest.getInstrumentCandles({
      instrumentId: args.instrument.etoroInstrumentId,
      direction: "desc",
      interval: ETORO_CANDLE_INTERVAL[timeframe],
      candlesCount: RECONCILE_CANDLE_COUNT,
    });
    for (const item of history) {
      const incoming = historyToCandle({
        history: item,
        instrumentId: args.instrument.id,
        timeframe,
        now,
      });
      const result = await upsertCandle({
        db: args.db,
        redis: args.redis,
        symbol: args.instrument.symbol,
        incoming,
      });
      if (result.action === "revise") {
        revisions += 1;
        await persistIndicatorSnapshot({
          db: args.db,
          redis: args.redis,
          symbol: args.instrument.symbol,
          instrumentId: args.instrument.id,
          timeframe,
        });
      }
    }
  }
  return revisions;
}

export function adoptCandleBuilder(args: {
  builders: Map<string, CandleBuilder>;
  key: string;
  incoming: CandleBuilder;
}): void {
  const existing = args.builders.get(args.key);
  if (!existing) {
    args.builders.set(args.key, args.incoming);
    return;
  }
  const seed = args.incoming.getCurrent();
  if (seed) {
    existing.mergeSeed({ candle: seed });
  }
}

function rowToCandle(row: typeof candles.$inferSelect): Candle {
  return {
    instrumentId: row.instrumentId,
    timeframe: row.timeframe as Timeframe,
    openTimeUtc: row.openTimeUtc,
    closeTimeUtc: row.closeTimeUtc,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    source: row.source as Candle["source"],
    isFinal: row.isFinal,
    revision: row.revision,
  };
}
