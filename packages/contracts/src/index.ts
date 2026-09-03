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
  realizedDailyPnl: z.string().nullable(),
  openPositionCount: z.number().int().nullable(),
  historyUnavailable: z.boolean(),
  capturedAt: z.string().nullable(),
});

export const brokerPositionDtoSchema = z.object({
  etoroPositionId: z.string(),
  instrumentId: z.number().int(),
  symbol: z.string().nullable(),
  direction: z.enum(["LONG", "SHORT", "NEUTRAL"]),
  openedAt: z.string().nullable(),
  openPrice: z.string().nullable(),
  units: z.string().nullable(),
  investedAmount: z.string().nullable(),
  leverage: z.string().nullable(),
  stopLoss: z.string().nullable(),
  takeProfit: z.string().nullable(),
  unrealizedPnl: z.string().nullable(),
  fees: z.string().nullable(),
});

export const brokerTradeDtoSchema = z.object({
  etoroPositionId: z.string(),
  instrumentId: z.number().int(),
  symbol: z.string().nullable(),
  direction: z.enum(["LONG", "SHORT", "NEUTRAL"]),
  openedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  openPrice: z.string().nullable(),
  closePrice: z.string().nullable(),
  units: z.string().nullable(),
  investedAmount: z.string().nullable(),
  realizedPnl: z.string().nullable(),
  fees: z.string().nullable(),
  sourceAccount: z.enum(["REAL", "DEMO"]),
});

export const positionsResponseSchema = z.object({
  available: z.boolean(),
  positions: z.array(brokerPositionDtoSchema),
});

export const historyResponseSchema = z.object({
  available: z.boolean(),
  historyUnavailable: z.boolean(),
  trades: z.array(brokerTradeDtoSchema),
});

export const riskProfileSchema = z.object({
  maxRiskPerTradePct: z.number().positive().max(100),
  maxDailyLossPct: z.number().positive().max(100),
  maxConsecutiveLosses: z.number().int().min(1).max(20),
  cooldownAfterLossMinutes: z.number().int().min(0).max(24 * 60),
  minimumRewardRisk: z.number().positive().max(20),
  maxConcurrentCorrelatedPositions: z.number().int().min(1).max(20),
  prohibitRiskIncreaseAfterLoss: z.boolean(),
  prohibitMartingale: z.boolean(),
});

export const psychologyChecklistSchema = z.object({
  definedEntry: z.boolean(),
  definedStop: z.boolean(),
  minimumRr: z.boolean(),
  notRecovering: z.boolean(),
  notChasing: z.boolean(),
  knowHtf: z.boolean(),
  noBlackoutImminent: z.boolean(),
  wouldStillTake: z.boolean(),
});

export const riskStatusSchema = z.object({
  available: z.boolean(),
  tradingStatus: z.enum(["ACTIVE", "COOLDOWN", "SESSION_BLOCKED", "NEWS_BLACKOUT"]),
  equity: z.string().nullable(),
  dailyPnl: z.string().nullable(),
  riskRemainingUsd: z.string().nullable(),
  consecutiveLosses: z.number().int(),
  cooldownUntil: z.string().nullable(),
  newsBlackout: z.boolean(),
  historyUnavailable: z.boolean(),
  lastSyncAt: z.string().nullable(),
  lastSyncLatencyMs: z.number().int().nullable(),
  syncErrorCount: z.number().int(),
  profile: riskProfileSchema,
});

export const riskEvaluationSchema = z.object({
  allowed: z.boolean(),
  blockReasons: z.array(z.string()),
  tradingStatus: riskStatusSchema.shape.tradingStatus,
  maxLossUsd: z.string().nullable(),
  maxRiskPct: z.string(),
  positionSizeUsd: z.string().nullable(),
  minTarget: z.string().nullable(),
  expectedR: z.string().nullable(),
  dailyPnl: z.string(),
  consecutiveLosses: z.number().int(),
  cooldownUntil: z.string().nullable(),
  newsBlackout: z.boolean(),
});

export const economicEventDtoSchema = z.object({
  id: z.string(),
  eventName: z.string(),
  currency: z.string(),
  impact: z.enum(["LOW", "MEDIUM", "HIGH"]),
  scheduledAtUtc: z.string(),
  blackoutBeforeMinutes: z.number().int(),
  blackoutAfterMinutes: z.number().int(),
});

export const eventsResponseSchema = z.object({
  available: z.boolean(),
  newsBlackout: z.boolean(),
  events: z.array(economicEventDtoSchema),
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
  enteredAt: z.string().nullable(),
  closedAt: z.string().nullable(),
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
  status: z.enum(["APPROVED", "BLOCKED", "REJECTED", "PENDING_CHECKLIST"]),
  signalId: z.string(),
  planId: z.string().nullable(),
  allowed: z.boolean(),
  blockReasons: z.array(z.string()),
  missingChecklist: z.array(z.string()),
  evaluation: riskEvaluationSchema.nullable(),
});

export const healthLiveSchema = z.object({
  status: z.literal("ok"),
});

export const queueStatsSchema = z.object({
  depth: z.number().int().nonnegative(),
  lagMs: z.number().int().nonnegative(),
  updatedAt: z.string(),
});

export function readQueueStatsPayload(args: { raw: string | null; now?: number }): {
  queueDepth: number | null;
  workerLagMs: number | null;
} {
  if (!args.raw) {
    return { queueDepth: null, workerLagMs: null };
  }
  try {
    const parsed = queueStatsSchema.safeParse(JSON.parse(args.raw));
    if (!parsed.success) {
      return { queueDepth: null, workerLagMs: null };
    }
    const finishedAt = Date.parse(parsed.data.updatedAt);
    if (!Number.isFinite(finishedAt)) {
      return { queueDepth: parsed.data.depth, workerLagMs: null };
    }
    return {
      queueDepth: parsed.data.depth,
      workerLagMs: Math.max(0, (args.now ?? Date.now()) - finishedAt),
    };
  } catch {
    return { queueDepth: null, workerLagMs: null };
  }
}

export const healthReadySchema = z.object({
  ready: z.boolean(),
  checks: z.object({
    database: z.boolean(),
    redis: z.boolean(),
    marketStream: z.boolean(),
    credentials: z.boolean(),
  }),
  queueDepth: z.number().int().nonnegative().nullable().optional(),
  workerLagMs: z.number().int().nonnegative().nullable().optional(),
});

export const authSessionSchema = z.object({
  required: z.boolean(),
  authenticated: z.boolean(),
});

export const executionStatusSchema = z.object({
  allowed: z.boolean(),
  accountType: z.enum(["real", "demo"]),
  enabled: z.boolean(),
  blockReasons: z.array(z.string()),
});

export const executionCostDtoSchema = z.object({
  costType: z.string(),
  amount: z.string(),
  currency: z.string(),
});

export const executionPreviewSchema = z.object({
  allowed: z.boolean(),
  blockReasons: z.array(z.string()),
  nonce: z.string().nullable(),
  requestId: z.string().nullable(),
  action: z.enum(["open", "close"]),
  amount: z.string().nullable(),
  instrumentId: z.number().int().nullable(),
  leverage: z.literal(1),
  stopLoss: z.string().nullable(),
  takeProfit: z.string().nullable(),
  costs: z.array(executionCostDtoSchema),
  evaluation: riskEvaluationSchema.nullable(),
});

export const executionConfirmSchema = z.object({
  status: z.enum(["FILLED", "REJECTED", "AMBIGUOUS", "BLOCKED"]),
  orderId: z.string().nullable(),
  etoroOrderId: z.string().nullable(),
  referenceId: z.string().nullable(),
  blockReasons: z.array(z.string()),
});

export const alertTypeSchema = z.enum([
  "WATCHLIST_OPPORTUNITY",
  "ENTRY_CONFIRMATION",
  "SIGNAL_INVALIDATED",
  "DO_NOT_CHASE",
  "MAJOR_LEVEL_APPROACHING",
  "PRICE_ZONE_BROKEN",
  "RETEST_DETECTED",
  "RISK_LIMIT_HIT",
  "STREAM_STALE",
  "POSITION_DETECTED",
  "POSITION_CLOSED",
]);

export const alertDtoSchema = z.object({
  id: z.string(),
  type: alertTypeSchema,
  instrumentId: z.string(),
  symbol: z.string(),
  signalId: z.string().nullable(),
  zoneId: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  score: z.number().int().nullable(),
  direction: z.enum(["LONG", "SHORT", "NEUTRAL"]).nullable(),
  state: z.string().nullable(),
  dedupeKey: z.string(),
  channels: z.array(z.enum(["in_app", "browser", "telegram"])),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});

export const alertsResponseSchema = z.object({
  available: z.boolean(),
  staleStream: z.boolean(),
  unreadCount: z.number().int(),
  alerts: z.array(alertDtoSchema),
});

export const alertSettingsSchema = z.object({
  enabled: z.boolean(),
  browserEnabled: z.boolean(),
  telegramEnabled: z.boolean(),
  scoreThreshold: z.number().int().min(0).max(100),
  scoreDelta: z.number().int().min(1).max(100),
  cooldownMinutes: z.number().int().min(0).max(24 * 60),
  mutedTypes: z.array(alertTypeSchema),
  mutedSymbols: z.array(z.enum(["US30", "US100", "SPX500", "GOLD"])),
});

export const settingsResponseSchema = z.object({
  available: z.boolean(),
  telegramConfigured: z.boolean(),
  alerts: alertSettingsSchema,
  risk: riskProfileSchema,
  markets: z.record(z.unknown()),
});

export const journalMatchStatusSchema = z.enum(["LINKED", "UNMATCHED", "UNGATED"]);

export const journalEntryDtoSchema = z.object({
  id: z.string(),
  etoroPositionId: z.string(),
  brokerTradeId: z.string().nullable(),
  tradePlanId: z.string().nullable(),
  signalId: z.string().nullable(),
  setupKey: z.string().nullable(),
  matchStatus: journalMatchStatusSchema,
  matchLocked: z.boolean(),
  symbol: z.string().nullable(),
  direction: z.enum(["LONG", "SHORT", "NEUTRAL"]),
  openedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  openPrice: z.string().nullable(),
  closePrice: z.string().nullable(),
  units: z.string().nullable(),
  realizedPnl: z.string().nullable(),
  fees: z.string().nullable(),
  resultR: z.string().nullable(),
  maeUsd: z.string().nullable(),
  maeR: z.string().nullable(),
  mfeUsd: z.string().nullable(),
  mfeR: z.string().nullable(),
  followedPlan: z.boolean().nullable(),
  ruleBreaks: z.array(z.string()),
  thesisText: z.string().nullable(),
  preTradeEmotion: z.string().nullable(),
  postTradeEmotion: z.string().nullable(),
  notes: z.string().nullable(),
  screenshotUrl: z.string().nullable(),
  tags: z.array(z.string()),
  alignedWithTrend: z.boolean().nullable(),
  snapshotJson: z.record(z.unknown()),
  evidenceJson: z.record(z.unknown()),
});

export const journalLinkablePlanSchema = z.object({
  id: z.string(),
  signalId: z.string(),
  symbol: z.string(),
  direction: z.enum(["LONG", "SHORT", "NEUTRAL"]),
  approvedAt: z.string(),
  expectedR: z.string().nullable(),
});

export const journalListResponseSchema = z.object({
  available: z.boolean(),
  historyUnavailable: z.boolean(),
  entries: z.array(journalEntryDtoSchema),
});

export const journalDetailResponseSchema = z.object({
  available: z.boolean(),
  entry: journalEntryDtoSchema.nullable(),
  plan: z
    .object({
      id: z.string(),
      riskPct: z.string().nullable(),
      riskAmountUsd: z.string().nullable(),
      expectedR: z.string().nullable(),
      stopLoss: z.string().nullable(),
      target1: z.string().nullable(),
      gateStatus: z.string(),
      checklistJson: z.unknown(),
    })
    .nullable(),
  signal: signalDtoSchema.nullable(),
  linkablePlans: z.array(journalLinkablePlanSchema),
});

export const journalPatchSchema = z.object({
  notes: z.string().optional(),
  thesisText: z.string().optional(),
  preTradeEmotion: z.string().optional(),
  postTradeEmotion: z.string().optional(),
  followedPlan: z.boolean().nullable().optional(),
  ruleBreaks: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  tradePlanId: z.string().nullable().optional(),
});

export const metricBucketSchema = z.object({
  key: z.string(),
  count: z.number().int(),
  netPnl: z.string().nullable(),
  winRate: z.string().nullable(),
  expectancyR: z.string().nullable(),
});

export const analyticsSplitSchema = z.object({
  count: z.number().int(),
  netPnl: z.string(),
  expectancyR: z.string().nullable(),
  winRate: z.string().nullable().optional(),
});

export const analyticsSummaryResponseSchema = z.object({
  available: z.boolean(),
  empty: z.boolean(),
  summary: z
    .object({
      closedCount: z.number().int(),
      netPnl: z.string(),
      winRate: z.string().nullable(),
      averageWin: z.string().nullable(),
      averageLoss: z.string().nullable(),
      payoffRatio: z.string().nullable(),
      expectancyR: z.string().nullable(),
      profitFactor: z.string().nullable(),
      maxDrawdown: z.string(),
      averageMae: z.string().nullable(),
      averageMfe: z.string().nullable(),
      ruleAdherenceRate: z.string().nullable(),
      feesPctOfGross: z.string().nullable(),
      gated: analyticsSplitSchema,
      ungated: analyticsSplitSchema,
    })
    .nullable(),
});

export const analyticsSetupsResponseSchema = z.object({
  available: z.boolean(),
  empty: z.boolean(),
  setups: z.array(metricBucketSchema),
});

export const analyticsInstrumentsResponseSchema = z.object({
  available: z.boolean(),
  empty: z.boolean(),
  instruments: z.array(metricBucketSchema),
});

export const analyticsPsychologyResponseSchema = z.object({
  available: z.boolean(),
  empty: z.boolean(),
  psychology: z
    .object({
      followed: analyticsSplitSchema,
      broken: analyticsSplitSchema,
      disciplineAtOrAbove: analyticsSplitSchema,
      disciplineBelow: analyticsSplitSchema,
      afterWin: analyticsSplitSchema,
      afterLoss: analyticsSplitSchema,
      long: analyticsSplitSchema,
      short: analyticsSplitSchema,
      trendAligned: analyticsSplitSchema,
      countertrend: analyticsSplitSchema,
      byHourUtc: z.array(metricBucketSchema),
    })
    .nullable(),
});

export const backtestCostsSchema = z.object({
  slippage: z.string(),
  spread: z.string(),
  feeBps: z.string(),
  units: z.string(),
});

export const createBacktestSchema = z.object({
  symbol: z.enum(["US30", "US100", "SPX500", "GOLD"]),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  strategyKey: z.enum(["breakdown-retest", "sweep-reclaim", "trend-pullback", "do-not-chase"]).optional(),
  walkForwardMode: z.enum(["none", "split", "rolling"]).optional(),
  costs: backtestCostsSchema.partial().optional(),
});

export const createReplaySessionSchema = z.object({
  symbol: z.enum(["US30", "US100", "SPX500", "GOLD"]),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const finiteDecimalString = z.string().regex(/^-?\d+(\.\d+)?$/);

export const paperTradeSchema = z.object({
  direction: z.enum(["LONG", "SHORT"]),
  stopLoss: finiteDecimalString,
  target1: finiteDecimalString,
});

export const backtestTradeDtoSchema = z.object({
  id: z.string(),
  strategyKey: z.string(),
  strategyVersion: z.string(),
  direction: z.enum(["LONG", "SHORT", "NEUTRAL"]),
  status: z.enum(["filled", "closed", "open", "unfillable"]),
  unfillableReason: z.enum(["gap"]).nullable(),
  openedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  entryPrice: z.string().nullable(),
  exitPrice: z.string().nullable(),
  realizedPnl: z.string().nullable(),
  fees: z.string().nullable(),
  resultR: z.string().nullable(),
  maeUsd: z.string().nullable(),
  mfeUsd: z.string().nullable(),
  exitReason: z.string().nullable(),
});

export const backtestMetricsSchema = z.object({
  empty: z.boolean(),
  tradeCount: z.number().int(),
  setupCount: z.number().int(),
  winRate: z.string().nullable(),
  expectancyR: z.string().nullable(),
  profitFactor: z.string().nullable(),
  maxDrawdown: z.string().nullable(),
  averageR: z.string().nullable(),
  averageMae: z.string().nullable(),
  averageMfe: z.string().nullable(),
  netPnl: z.string().nullable(),
  timeInMarketBars: z.number().int(),
  consecutiveWins: z.number().int(),
  consecutiveLosses: z.number().int(),
});

export const walkForwardWindowDtoSchema = z.object({
  kind: z.enum(["in-sample", "out-of-sample"]),
  from: z.string(),
  to: z.string(),
  metrics: backtestMetricsSchema,
});

export const backtestRunDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(["backtest", "replay"]),
  symbol: z.string(),
  strategyKey: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  walkForwardMode: z.enum(["none", "split", "rolling"]),
  status: z.enum(["completed", "empty", "error"]),
  emptyReason: z.string().nullable(),
  warmupBars: z.number().int(),
  barCount: z.number().int(),
  metrics: backtestMetricsSchema.nullable(),
  windows: z.array(walkForwardWindowDtoSchema),
  createdAt: z.string(),
});

export const backtestRunResponseSchema = z.object({
  available: z.boolean(),
  run: backtestRunDtoSchema.nullable(),
});

export const backtestTradesResponseSchema = z.object({
  available: z.boolean(),
  trades: z.array(backtestTradeDtoSchema),
});

export const replaySignalDtoSchema = z.object({
  id: z.string(),
  strategyKey: z.string(),
  strategyVersion: z.string(),
  direction: z.enum(["LONG", "SHORT", "NEUTRAL"]),
  state: z.string(),
  score: z.number().int(),
  confirmedAt: z.string().nullable(),
  entryZoneLow: z.string().nullable(),
  entryZoneHigh: z.string().nullable(),
  invalidationPrice: z.string().nullable(),
  target1: z.string().nullable(),
});

export const replayFrameResponseSchema = z.object({
  available: z.boolean(),
  empty: z.boolean(),
  emptyReason: z.string().nullable(),
  sessionId: z.string(),
  index: z.number().int(),
  barCount: z.number().int(),
  timeframe: z.enum(["15m", "1h", "4h"]),
  openTimeUtc: z.string().nullable(),
  candles: z.array(candleDtoSchema),
  zones: z.array(priceZoneDtoSchema),
  indicators: indicatorSnapshotDtoSchema.nullable(),
  signals: z.array(replaySignalDtoSchema),
  paperTrades: z.array(backtestTradeDtoSchema),
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
      unreadCount: z.number().int().optional(),
    }),
  }),
  z.object({
    type: z.literal("signal"),
    payload: z.object({
      id: z.string(),
      instrumentId: z.string(),
      symbol: z.string(),
      state: z.string(),
      score: z.number().int(),
    }),
  }),
  z.object({
    type: z.literal("alert"),
    payload: alertDtoSchema,
  }),
  z.object({
    type: z.literal("account"),
    payload: accountResponseSchema.partial().optional(),
  }),
  z.object({
    type: z.literal("risk"),
    payload: riskStatusSchema.partial().optional(),
  }),
]);

export type MarketQuote = z.infer<typeof marketQuoteSchema>;
export type MarketsResponse = z.infer<typeof marketsResponseSchema>;
export type AccountResponse = z.infer<typeof accountResponseSchema>;
export type BrokerPositionDto = z.infer<typeof brokerPositionDtoSchema>;
export type BrokerTradeDto = z.infer<typeof brokerTradeDtoSchema>;
export type PositionsResponse = z.infer<typeof positionsResponseSchema>;
export type HistoryResponse = z.infer<typeof historyResponseSchema>;
export type RiskProfileDto = z.infer<typeof riskProfileSchema>;
export type RiskStatus = z.infer<typeof riskStatusSchema>;
export type RiskEvaluationDto = z.infer<typeof riskEvaluationSchema>;
export type PsychologyChecklistDto = z.infer<typeof psychologyChecklistSchema>;
export type EconomicEventDto = z.infer<typeof economicEventDtoSchema>;
export type EventsResponse = z.infer<typeof eventsResponseSchema>;
export type QueueStats = z.infer<typeof queueStatsSchema>;
export type HealthReady = z.infer<typeof healthReadySchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;
export type ExecutionPreview = z.infer<typeof executionPreviewSchema>;
export type ExecutionConfirm = z.infer<typeof executionConfirmSchema>;
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
export type AlertDto = z.infer<typeof alertDtoSchema>;
export type AlertsResponse = z.infer<typeof alertsResponseSchema>;
export type AlertSettingsDto = z.infer<typeof alertSettingsSchema>;
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;
export type JournalEntryDto = z.infer<typeof journalEntryDtoSchema>;
export type JournalListResponse = z.infer<typeof journalListResponseSchema>;
export type JournalDetailResponse = z.infer<typeof journalDetailResponseSchema>;
export type JournalPatch = z.infer<typeof journalPatchSchema>;
export type AnalyticsSummaryResponse = z.infer<typeof analyticsSummaryResponseSchema>;
export type AnalyticsSetupsResponse = z.infer<typeof analyticsSetupsResponseSchema>;
export type AnalyticsInstrumentsResponse = z.infer<typeof analyticsInstrumentsResponseSchema>;
export type AnalyticsPsychologyResponse = z.infer<typeof analyticsPsychologyResponseSchema>;
export type CreateBacktest = z.infer<typeof createBacktestSchema>;
export type CreateReplaySession = z.infer<typeof createReplaySessionSchema>;
export type PaperTradeRequest = z.infer<typeof paperTradeSchema>;
export type BacktestTradeDto = z.infer<typeof backtestTradeDtoSchema>;
export type BacktestMetricsDto = z.infer<typeof backtestMetricsSchema>;
export type BacktestRunDto = z.infer<typeof backtestRunDtoSchema>;
export type BacktestRunResponse = z.infer<typeof backtestRunResponseSchema>;
export type BacktestTradesResponse = z.infer<typeof backtestTradesResponseSchema>;
export type ReplayFrameResponse = z.infer<typeof replayFrameResponseSchema>;
