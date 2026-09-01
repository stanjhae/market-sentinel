import type {
  CandleDto,
  CandlesResponse,
  MarketContextResponse,
  MarketQuote,
  MarketRegimeDto,
  PriceZoneDto,
} from "@market-sentinel/contracts";
import { REDIS_KEYS } from "@market-sentinel/contracts";
import { candles, indicatorSnapshots, instruments, marketRegimes, priceZones, type Database } from "@market-sentinel/db";
import { TIMEFRAMES, isTimeframe, parseWatchlistSymbol, type Timeframe } from "@market-sentinel/domain";
import { buildMultiTimeframeContext } from "@market-sentinel/market-structure";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Redis } from "ioredis";
import { readMarkets } from "./markets.js";

export const CANDLE_QUERY_LIMIT = 1000;
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?)?$/;

export function emptyCandles(args: { symbol: string; timeframe: Timeframe }): CandlesResponse {
  return {
    available: false,
    symbol: args.symbol,
    timeframe: args.timeframe,
    candles: [],
  };
}

export async function readCandles(args: {
  db: Database;
  redis: Redis;
  symbol: string;
  timeframe: Timeframe;
  from?: Date;
  to?: Date;
}): Promise<CandlesResponse> {
  const symbol = parseWatchlistSymbol({ value: args.symbol });
  if (!symbol) {
    return emptyCandles({ symbol: args.symbol, timeframe: args.timeframe });
  }
  const instrument = await args.db
    .select()
    .from(instruments)
    .where(eq(instruments.canonicalSymbol, symbol))
    .limit(1);
  const row = instrument[0];
  if (!row) {
    return emptyCandles({ symbol: args.symbol, timeframe: args.timeframe });
  }

  const filters = [
    eq(candles.instrumentId, row.id),
    eq(candles.timeframe, args.timeframe),
    args.from ? gte(candles.openTimeUtc, args.from) : undefined,
    args.to ? lte(candles.openTimeUtc, args.to) : undefined,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));

  const rows = await args.db
    .select()
    .from(candles)
    .where(and(...filters))
    .orderBy(desc(candles.openTimeUtc))
    .limit(CANDLE_QUERY_LIMIT);

  const mapped: CandleDto[] = rows
    .slice()
    .reverse()
    .map((item) => ({
      instrumentId: item.instrumentId,
      symbol,
      timeframe: args.timeframe,
      openTimeUtc: item.openTimeUtc.toISOString(),
      closeTimeUtc: item.closeTimeUtc.toISOString(),
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume,
      source: item.source as CandleDto["source"],
      isFinal: item.isFinal,
      revision: item.revision,
    }));

  const liveRaw = await args.redis.get(REDIS_KEYS.candle(symbol, args.timeframe));
  const live = liveRaw ? (JSON.parse(liveRaw) as CandleDto) : null;

  return {
    available: true,
    symbol,
    timeframe: args.timeframe,
    candles: overlayLiveCandle({
      candles: mapped,
      live,
      timeframe: args.timeframe,
      from: args.from,
      to: args.to,
    }),
  };
}

export async function readMarketContext(args: {
  db: Database;
  redis: Redis;
  symbol: string;
  staleAfterMs: number;
}): Promise<MarketContextResponse> {
  const symbol = parseWatchlistSymbol({ value: args.symbol });
  const quote = await quoteForSymbol({
    redis: args.redis,
    symbol: symbol ?? args.symbol,
    staleAfterMs: args.staleAfterMs,
  });
  if (!symbol) {
    return emptyContext({ symbol: args.symbol, quote });
  }

  const instrument = await args.db
    .select()
    .from(instruments)
    .where(eq(instruments.canonicalSymbol, symbol))
    .limit(1);
  const row = instrument[0];
  if (!row) {
    return emptyContext({ symbol: args.symbol, quote });
  }

  const timeframes = emptyTimeframes();
  let previousRsi15m: string | null = null;
  for (const timeframe of TIMEFRAMES) {
    const liveRaw = await args.redis.get(REDIS_KEYS.candle(symbol, timeframe));
    const currentCandle = liveRaw ? (JSON.parse(liveRaw) as CandleDto) : null;
    const finals = await args.db
      .select()
      .from(candles)
      .where(and(eq(candles.instrumentId, row.id), eq(candles.timeframe, timeframe), eq(candles.isFinal, true)))
      .orderBy(desc(candles.openTimeUtc))
      .limit(1);
    const finalRow = finals[0];
    const lastFinalCandle: CandleDto | null = finalRow
      ? {
          instrumentId: finalRow.instrumentId,
          symbol,
          timeframe,
          openTimeUtc: finalRow.openTimeUtc.toISOString(),
          closeTimeUtc: finalRow.closeTimeUtc.toISOString(),
          open: finalRow.open,
          high: finalRow.high,
          low: finalRow.low,
          close: finalRow.close,
          volume: finalRow.volume,
          source: finalRow.source as CandleDto["source"],
          isFinal: finalRow.isFinal,
          revision: finalRow.revision,
        }
      : null;
    const indicatorRows = await args.db
      .select()
      .from(indicatorSnapshots)
      .where(and(eq(indicatorSnapshots.instrumentId, row.id), eq(indicatorSnapshots.timeframe, timeframe)))
      .orderBy(desc(indicatorSnapshots.candleOpenTime))
      .limit(timeframe === "15m" ? 2 : 1);
    const indicator = indicatorRows[0];
    if (timeframe === "15m") {
      previousRsi15m = indicatorRows[1]?.rsi14 ?? null;
    }
    const regimeRows = await args.db
      .select()
      .from(marketRegimes)
      .where(and(eq(marketRegimes.instrumentId, row.id), eq(marketRegimes.timeframe, timeframe)))
      .orderBy(desc(marketRegimes.timestamp))
      .limit(1);
    timeframes[timeframe] = {
      currentCandle,
      lastFinalCandle,
      indicators: indicator
        ? {
            instrumentId: indicator.instrumentId,
            timeframe,
            candleOpenTime: indicator.candleOpenTime.toISOString(),
            rsi14: indicator.rsi14,
            atr14: indicator.atr14,
            ema20: indicator.ema20,
            ema50: indicator.ema50,
            ema200: indicator.ema200,
            bbBasis20: indicator.bbBasis20,
            bbUpper20x2: indicator.bbUpper20x2,
            bbLower20x2: indicator.bbLower20x2,
            bbWidth: indicator.bbWidth,
            trueRange: indicator.trueRange,
            rollingVolatility: indicator.rollingVolatility,
          }
        : null,
      regime: regimeRows[0] ? toRegimeDto({ row: regimeRows[0] }) : null,
    };
  }

  const zoneRows = await args.db.select().from(priceZones).where(eq(priceZones.instrumentId, row.id));
  const zones = zoneRows.map((item) => toZoneDto({ row: item, symbol }));
  const bars15m = await args.db
    .select()
    .from(candles)
    .where(and(eq(candles.instrumentId, row.id), eq(candles.timeframe, "15m"), eq(candles.isFinal, true)))
    .orderBy(desc(candles.openTimeUtc))
    .limit(3);
  const previous1h = await args.db
    .select()
    .from(marketRegimes)
    .where(and(eq(marketRegimes.instrumentId, row.id), eq(marketRegimes.timeframe, "1h")))
    .orderBy(desc(marketRegimes.timestamp))
    .limit(2);
  const tf15 = timeframes["15m"];
  const tf1h = timeframes["1h"];
  const tf4h = timeframes["4h"];
  const multiTimeframe = buildMultiTimeframeContext({
    regimes: {
      "15m": tf15?.regime ? fromRegimeDto({ dto: tf15.regime }) : null,
      "1h": tf1h?.regime ? fromRegimeDto({ dto: tf1h.regime }) : null,
      "4h": tf4h?.regime ? fromRegimeDto({ dto: tf4h.regime }) : null,
    },
    zones: zones.map((zone) => fromZoneDto({ dto: zone })),
    bars15m: bars15m
      .slice()
      .reverse()
      .map((item) => ({
        instrumentId: item.instrumentId,
        timeframe: "15m" as const,
        openTimeUtc: item.openTimeUtc,
        high: item.high,
        low: item.low,
        open: item.open,
        close: item.close,
        isFinal: item.isFinal,
      })),
    indicators15m: {
      rsi14: tf15?.indicators?.rsi14 ?? null,
      previousRsi14: previousRsi15m,
      atr14: tf15?.indicators?.atr14 ?? null,
      bbBasis20: tf15?.indicators?.bbBasis20 ?? null,
      bbUpper20x2: tf15?.indicators?.bbUpper20x2 ?? null,
      bbLower20x2: tf15?.indicators?.bbLower20x2 ?? null,
    },
    close1h: tf1h?.lastFinalCandle?.close ?? null,
    atr1h: tf1h?.indicators?.atr14 ?? null,
    previousStructure1h: (previous1h[1]?.structure as "HH_HL" | "LH_LL" | "MIXED" | undefined) ?? null,
  });

  return { available: true, symbol, quote, timeframes, zones, multiTimeframe };
}

export function parseTimeframeQuery(args: { value: unknown }): Timeframe | null {
  if (args.value === undefined || args.value === "") {
    return "15m";
  }
  if (typeof args.value === "string" && isTimeframe(args.value)) {
    return args.value;
  }
  return null;
}

export function parseIsoDateQuery(args: { value: unknown }): { ok: true; date?: Date } | { ok: false } {
  if (args.value === undefined || args.value === "") {
    return { ok: true };
  }
  if (typeof args.value !== "string" || !ISO_DATE.test(args.value)) {
    return { ok: false };
  }
  const date = new Date(args.value);
  if (Number.isNaN(date.getTime())) {
    return { ok: false };
  }
  return { ok: true, date };
}

export function openTimeInRange(args: { openTimeUtc: string; from?: Date; to?: Date }): boolean {
  const time = Date.parse(args.openTimeUtc);
  if (Number.isNaN(time)) {
    return false;
  }
  if (args.from && time < args.from.getTime()) {
    return false;
  }
  if (args.to && time > args.to.getTime()) {
    return false;
  }
  return true;
}

export function overlayLiveCandle(args: {
  candles: CandleDto[];
  live: CandleDto | null;
  timeframe: Timeframe;
  from?: Date;
  to?: Date;
}): CandleDto[] {
  const live = args.live;
  if (!live || live.timeframe !== args.timeframe) {
    return args.candles;
  }
  if (!openTimeInRange({ openTimeUtc: live.openTimeUtc, from: args.from, to: args.to })) {
    return args.candles;
  }
  const next = args.candles.slice();
  const index = next.findIndex((item) => item.openTimeUtc === live.openTimeUtc);
  if (index >= 0) {
    next[index] = live;
    return next;
  }
  next.push(live);
  return next.sort((left, right) => Date.parse(left.openTimeUtc) - Date.parse(right.openTimeUtc));
}

export function newestThenChronological<T extends { openTimeUtc: string }>(args: {
  candles: T[];
  limit: number;
}): T[] {
  return args.candles
    .slice()
    .sort((left, right) => Date.parse(right.openTimeUtc) - Date.parse(left.openTimeUtc))
    .slice(0, args.limit)
    .sort((left, right) => Date.parse(left.openTimeUtc) - Date.parse(right.openTimeUtc));
}

export function emptyContext(args: { symbol: string; quote?: MarketQuote | null }): MarketContextResponse {
  return {
    available: false,
    symbol: args.symbol,
    quote: args.quote ?? null,
    timeframes: emptyTimeframes(),
    zones: [],
    multiTimeframe: null,
  };
}

function emptyTimeframes(): MarketContextResponse["timeframes"] {
  return {
    "15m": { currentCandle: null, lastFinalCandle: null, indicators: null, regime: null },
    "1h": { currentCandle: null, lastFinalCandle: null, indicators: null, regime: null },
    "4h": { currentCandle: null, lastFinalCandle: null, indicators: null, regime: null },
  };
}

export function toZoneDto(args: { row: typeof priceZones.$inferSelect; symbol: string }): PriceZoneDto {
  return {
    id: args.row.id,
    instrumentId: args.row.instrumentId,
    symbol: args.symbol,
    timeframe: args.row.timeframe as Timeframe,
    type: args.row.type as PriceZoneDto["type"],
    source: args.row.source as PriceZoneDto["source"],
    lowerBound: args.row.lowerBound,
    upperBound: args.row.upperBound,
    midpoint: args.row.midpoint,
    strengthScore: args.row.strengthScore,
    touchCount: args.row.touchCount,
    lastTouchedAt: args.row.lastTouchedAt?.toISOString() ?? null,
    status: args.row.status as PriceZoneDto["status"],
    metadataJson: (args.row.metadataJson as Record<string, unknown>) ?? {},
  };
}

function toRegimeDto(args: { row: typeof marketRegimes.$inferSelect }): MarketRegimeDto {
  return {
    instrumentId: args.row.instrumentId,
    timeframe: args.row.timeframe as Timeframe,
    timestamp: args.row.timestamp.toISOString(),
    trend: args.row.trend as MarketRegimeDto["trend"],
    structure: args.row.structure as MarketRegimeDto["structure"],
    volatility: args.row.volatility as MarketRegimeDto["volatility"],
    location: args.row.location as MarketRegimeDto["location"],
    confidence: args.row.confidence,
    evidenceJson: (args.row.evidenceJson as Record<string, unknown>) ?? {},
  };
}

function fromRegimeDto(args: { dto: MarketRegimeDto }) {
  return {
    instrumentId: args.dto.instrumentId,
    timeframe: args.dto.timeframe,
    timestamp: new Date(args.dto.timestamp),
    trend: args.dto.trend,
    structure: args.dto.structure,
    volatility: args.dto.volatility,
    location: args.dto.location,
    confidence: args.dto.confidence,
    evidenceJson: args.dto.evidenceJson,
  };
}

function fromZoneDto(args: { dto: PriceZoneDto }) {
  return {
    id: args.dto.id,
    instrumentId: args.dto.instrumentId,
    timeframe: args.dto.timeframe,
    type: args.dto.type,
    source: args.dto.source,
    lowerBound: args.dto.lowerBound,
    upperBound: args.dto.upperBound,
    midpoint: args.dto.midpoint,
    strengthScore: args.dto.strengthScore,
    touchCount: args.dto.touchCount,
    lastTouchedAt: args.dto.lastTouchedAt ? new Date(args.dto.lastTouchedAt) : null,
    status: args.dto.status,
    metadataJson: args.dto.metadataJson,
  };
}

async function quoteForSymbol(args: {
  redis: Redis;
  symbol: string;
  staleAfterMs: number;
}): Promise<MarketQuote | null> {
  const markets = await readMarkets(args.redis, args.staleAfterMs);
  const symbol = parseWatchlistSymbol({ value: args.symbol }) ?? args.symbol;
  return markets.markets.find((item) => item.symbol === symbol) ?? null;
}
