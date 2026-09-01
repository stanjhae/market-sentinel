export { REDIS_KEYS } from "./redis-keys.js";

import { z } from "zod";

export const marketQuoteSchema = z.object({
  symbol: z.string(),
  etoroInstrumentId: z.number().int().nullable(),
  displayName: z.string().nullable(),
  resolved: z.boolean(),
  bid: z.string().nullable(),
  ask: z.string().nullable(),
  last: z.string().nullable(),
  dailyChangePct: z.string().nullable(),
  lastQuoteAt: z.string().nullable(),
  freshness: z.enum(["LIVE", "DELAYED", "STALE", "DISCONNECTED"]),
});

export const marketsResponseSchema = z.object({
  etoroConnected: z.boolean(),
  streamStatus: z.enum(["LIVE", "DELAYED", "STALE", "DISCONNECTED"]),
  lastQuoteAt: z.string().nullable(),
  markets: z.array(marketQuoteSchema),
});

export const accountResponseSchema = z.object({
  available: z.boolean(),
  accountType: z.enum(["REAL", "DEMO"]).nullable(),
  equity: z.string().nullable(),
  cash: z.string().nullable(),
  availableCash: z.string().nullable(),
  invested: z.string().nullable(),
  unrealizedPnl: z.string().nullable(),
  capturedAt: z.string().nullable(),
});

export const candleDtoSchema = z.object({
  instrumentId: z.string(),
  symbol: z.string(),
  timeframe: z.enum(["15m", "1h", "4h"]),
  openTimeUtc: z.string(),
  closeTimeUtc: z.string(),
  open: z.string(),
  high: z.string(),
  low: z.string(),
  close: z.string(),
  volume: z.string().nullable(),
  source: z.enum(["ETORO_REST", "ETORO_STREAM_AGGREGATED"]),
  isFinal: z.boolean(),
  revision: z.number().int(),
});

export const indicatorSnapshotDtoSchema = z.object({
  instrumentId: z.string(),
  timeframe: z.enum(["15m", "1h", "4h"]),
  candleOpenTime: z.string(),
  rsi14: z.string().nullable(),
  atr14: z.string().nullable(),
  ema20: z.string().nullable(),
  ema50: z.string().nullable(),
  ema200: z.string().nullable(),
  bbBasis20: z.string().nullable(),
  bbUpper20x2: z.string().nullable(),
  bbLower20x2: z.string().nullable(),
  bbWidth: z.string().nullable(),
  trueRange: z.string().nullable(),
  rollingVolatility: z.string().nullable(),
});

export const candlesResponseSchema = z.object({
  available: z.boolean(),
  symbol: z.string(),
  timeframe: z.enum(["15m", "1h", "4h"]),
  candles: z.array(candleDtoSchema),
});

export const marketContextResponseSchema = z.object({
  available: z.boolean(),
  symbol: z.string(),
  quote: marketQuoteSchema.nullable(),
  timeframes: z.record(
    z.enum(["15m", "1h", "4h"]),
    z.object({
      currentCandle: candleDtoSchema.nullable(),
      lastFinalCandle: candleDtoSchema.nullable(),
      indicators: indicatorSnapshotDtoSchema.nullable(),
    }),
  ),
});

export const healthLiveSchema = z.object({
  status: z.literal("ok"),
});

export const healthReadySchema = z.object({
  ready: z.boolean(),
  checks: z.object({
    database: z.boolean(),
    redis: z.boolean(),
    marketStream: z.boolean(),
    credentials: z.boolean(),
  }),
});

export const sseEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("markets"),
    payload: marketsResponseSchema,
  }),
  z.object({
    type: z.literal("stream"),
    payload: z.object({
      streamStatus: z.enum(["LIVE", "DELAYED", "STALE", "DISCONNECTED"]),
      lastQuoteAt: z.string().nullable(),
    }),
  }),
]);

export type MarketQuote = z.infer<typeof marketQuoteSchema>;
export type MarketsResponse = z.infer<typeof marketsResponseSchema>;
export type AccountResponse = z.infer<typeof accountResponseSchema>;
export type HealthReady = z.infer<typeof healthReadySchema>;
export type SseEvent = z.infer<typeof sseEventSchema>;
export type CandleDto = z.infer<typeof candleDtoSchema>;
export type IndicatorSnapshotDto = z.infer<typeof indicatorSnapshotDtoSchema>;
export type CandlesResponse = z.infer<typeof candlesResponseSchema>;
export type MarketContextResponse = z.infer<typeof marketContextResponseSchema>;
