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
  regime4h: z.string().nullable(),
  structure1h: z.string().nullable(),
  momentum15m: z.string().nullable(),
  closestSupport: z.string().nullable(),
  closestResistance: z.string().nullable(),
  opportunityScore: z.number().int().nullable(),
  opportunityLabel: z.string().nullable(),
  signalState: z.string().nullable(),
  signalExplanation: z.string().nullable(),
  entryStatus: z.string().nullable(),
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

export const priceZoneDtoSchema = z.object({
  id: z.string(),
  instrumentId: z.string(),
  symbol: z.string(),
  timeframe: z.enum(["15m", "1h", "4h"]),
  type: z.enum(["SUPPORT", "RESISTANCE", "BOTH"]),
  source: z.enum(["AUTO_PIVOT", "USER_MANUAL", "PRIOR_DAY", "PRIOR_WEEK", "PSYCHOLOGICAL"]),
  lowerBound: z.string(),
  upperBound: z.string(),
  midpoint: z.string(),
  strengthScore: z.number(),
  touchCount: z.number().int(),
  lastTouchedAt: z.string().nullable(),
  status: z.enum(["ACTIVE", "BROKEN", "FLIPPED", "EXPIRED"]),
  metadataJson: z.record(z.unknown()),
});

export const marketRegimeDtoSchema = z.object({
  instrumentId: z.string(),
  timeframe: z.enum(["15m", "1h", "4h"]),
  timestamp: z.string(),
  trend: z.enum(["STRONG_BULL", "BULL", "RANGE", "BEAR", "STRONG_BEAR"]),
  structure: z.enum(["HH_HL", "LH_LL", "MIXED"]),
  volatility: z.enum(["LOW", "NORMAL", "HIGH", "EXTREME"]),
  location: z.enum(["AT_SUPPORT", "AT_RESISTANCE", "MID_RANGE", "EXTENDED_UP", "EXTENDED_DOWN"]),
  confidence: z.number().int(),
  evidenceJson: z.record(z.unknown()),
});

export const timingFlagsSchema = z.object({
  rejection: z.boolean(),
  reclaim: z.boolean(),
  failedRetest: z.boolean(),
  engulfingImpulse: z.boolean(),
  rsiReset: z.boolean(),
  bbMeanReclaim: z.boolean(),
  bbMeanLoss: z.boolean(),
});

export const setupFlagsSchema = z.object({
  continuation: z.boolean(),
  reversal: z.boolean(),
  breakout: z.boolean(),
  breakdown: z.boolean(),
  pullback: z.boolean(),
  consolidation: z.boolean(),
  structureTransition: z.boolean(),
});

export const multiTimeframeContextSchema = z.object({
  context4h: z.object({
    primaryTrend: marketRegimeDtoSchema.shape.trend.nullable(),
    majorSupport: z.string().nullable(),
    majorResistance: z.string().nullable(),
    extended: z.boolean(),
    volatility: marketRegimeDtoSchema.shape.volatility.nullable(),
  }),
  setup1h: setupFlagsSchema,
  timing15m: timingFlagsSchema,
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
      regime: marketRegimeDtoSchema.nullable(),
    }),
  ),
  zones: z.array(priceZoneDtoSchema),
  multiTimeframe: multiTimeframeContextSchema.nullable(),
});

export const zonesResponseSchema = z.object({
  available: z.boolean(),
  symbol: z.string(),
  zones: z.array(priceZoneDtoSchema),
});

export const signalDtoSchema = z.object({
  id: z.string(),
  instrumentId: z.string(),
  symbol: z.string(),
  strategyKey: z.string(),
  strategyVersion: z.string(),
  direction: z.enum(["LONG", "SHORT", "NEUTRAL"]),
  state: z.enum([
    "DETECTED",
    "WATCHING",
    "CONFIRMED",
    "TRADE_PLANNED",
    "ENTERED",
    "CLOSED",
    "INVALIDATED",
    "EXPIRED",
    "DISMISSED",
  ]),
  triggerTimeframe: z.enum(["15m", "1h", "4h"]),
  detectedAt: z.string(),
  watchingAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  tradePlannedAt: z.string().nullable(),
  invalidatedAt: z.string().nullable(),
  expiredAt: z.string().nullable(),
  dismissedAt: z.string().nullable(),
  score: z.number().int(),
  confidenceLabel: z.string(),
  entryStatus: z.string(),
  entryZoneLow: z.string().nullable(),
  entryZoneHigh: z.string().nullable(),
  invalidationPrice: z.string().nullable(),
  target1: z.string().nullable(),
  target2: z.string().nullable(),
  target3: z.string().nullable(),
  riskRewardToT1: z.string().nullable(),
  riskRewardToT2: z.string().nullable(),
  lastEvaluatedOpenTimeUtc: z.string(),
  evidenceJson: z.record(z.unknown()),
  snapshotJson: z.record(z.unknown()),
});

export const signalsResponseSchema = z.object({
  available: z.boolean(),
  staleStream: z.boolean(),
  signals: z.array(signalDtoSchema),
});

export const signalDetailResponseSchema = z.object({
  available: z.boolean(),
  signal: signalDtoSchema.nullable(),
});

export const createPlanResponseSchema = z.object({
  status: z.literal("STUB"),
  signalId: z.string(),
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
export type PriceZoneDto = z.infer<typeof priceZoneDtoSchema>;
export type MarketRegimeDto = z.infer<typeof marketRegimeDtoSchema>;
export type MultiTimeframeContextDto = z.infer<typeof multiTimeframeContextSchema>;
export type ZonesResponse = z.infer<typeof zonesResponseSchema>;
export type SignalDto = z.infer<typeof signalDtoSchema>;
export type SignalsResponse = z.infer<typeof signalsResponseSchema>;
export type SignalDetailResponse = z.infer<typeof signalDetailResponseSchema>;
export type CreatePlanResponse = z.infer<typeof createPlanResponseSchema>;
