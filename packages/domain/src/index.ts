export const WATCHLIST = ["US30", "US100", "SPX500", "GOLD"] as const;

export type CanonicalSymbol = (typeof WATCHLIST)[number];

export const TIMEFRAMES = ["15m", "1h", "4h"] as const;

export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
};

export function isWatchlistSymbol(value: string): value is CanonicalSymbol {
  return (WATCHLIST as readonly string[]).includes(value);
}

export function parseWatchlistSymbol(args: { value: string }): CanonicalSymbol | null {
  const normalized = args.value.toUpperCase();
  return isWatchlistSymbol(normalized) ? normalized : null;
}

export function isTimeframe(value: string): value is Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(value);
}

export type AccountType = "REAL" | "DEMO";

export type SignalState =
  | "DETECTED"
  | "WATCHING"
  | "CONFIRMED"
  | "TRADE_PLANNED"
  | "ENTERED"
  | "CLOSED"
  | "INVALIDATED"
  | "EXPIRED"
  | "DISMISSED";

export type SignalDirection = "LONG" | "SHORT" | "NEUTRAL";

export type ProposedSignalState = "NONE" | "DETECTED" | "WATCHING" | "CONFIRMED" | "INVALIDATED" | "EXPIRED";

export type OpportunityLabel = "Ignore" | "Weak" | "Interesting" | "Watch" | "Strong" | "Exceptional";

export type StrategyKey = "breakdown-retest" | "sweep-reclaim" | "trend-pullback" | "do-not-chase";

export const TERMINAL_SIGNAL_STATES = ["INVALIDATED", "EXPIRED", "DISMISSED", "CLOSED"] as const;

export function isTerminalSignalState(args: { state: SignalState }): boolean {
  return (TERMINAL_SIGNAL_STATES as readonly string[]).includes(args.state);
}

export function entryStatusFromState(args: { state: SignalState }): string {
  if (args.state === "WATCHING") {
    return "WAITING FOR CONFIRMATION";
  }
  if (args.state === "DETECTED") {
    return "DETECTED";
  }
  if (args.state === "CONFIRMED") {
    return "CONFIRMED";
  }
  if (args.state === "TRADE_PLANNED") {
    return "TRADE PLANNED";
  }
  if (args.state === "ENTERED") {
    return "ENTERED";
  }
  if (args.state === "CLOSED") {
    return "CLOSED";
  }
  if (args.state === "INVALIDATED") {
    return "INVALIDATED";
  }
  if (args.state === "EXPIRED") {
    return "EXPIRED";
  }
  return "DISMISSED";
}

export function opportunityLabelFromScore(args: { score: number }): OpportunityLabel {
  if (args.score >= 90) {
    return "Exceptional";
  }
  if (args.score >= 80) {
    return "Strong";
  }
  if (args.score >= 70) {
    return "Watch";
  }
  if (args.score >= 60) {
    return "Interesting";
  }
  if (args.score >= 50) {
    return "Weak";
  }
  return "Ignore";
}

export type TradingStatus = "ACTIVE" | "COOLDOWN" | "SESSION_BLOCKED" | "NEWS_BLACKOUT";

export type GateStatus = "BLOCKED" | "PENDING_CHECKLIST" | "APPROVED" | "REJECTED";

export type EntryType = "MARKET" | "LIMIT" | "STOP";

export type EventImpact = "LOW" | "MEDIUM" | "HIGH";

export type CorrelationBucket = "EQUITY_INDEX" | "GOLD" | "OTHER";

export function plannedEntryFromZone(args: { low: string | null; high: string | null }): string | null {
  if (args.low && args.high) {
    const low = Number(args.low);
    const high = Number(args.high);
    if (Number.isFinite(low) && Number.isFinite(high)) {
      return String((low + high) / 2);
    }
  }
  return args.low;
}

export function parseEventTimeUtc(args: { value: string }): Date | null {
  const raw = args.value.trim();
  if (!raw) {
    return null;
  }
  const hasZone = raw.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(raw);
  const iso = hasZone ? raw : raw.length === 16 ? `${raw}:00.000Z` : `${raw}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function decidePlanGate(args: {
  allowed: boolean;
  checklistComplete: boolean;
  signalState: SignalState;
}): "BLOCKED" | "PENDING_CHECKLIST" | "NOT_CONFIRMED" | "APPROVE" {
  if (!args.allowed) {
    return "BLOCKED";
  }
  if (!args.checklistComplete) {
    return "PENDING_CHECKLIST";
  }
  if (args.signalState !== "CONFIRMED") {
    return "NOT_CONFIRMED";
  }
  return "APPROVE";
}

export function correlationBucket(args: { symbol: string }): CorrelationBucket {
  if (args.symbol === "US30" || args.symbol === "US100" || args.symbol === "SPX500") {
    return "EQUITY_INDEX";
  }
  if (args.symbol === "GOLD") {
    return "GOLD";
  }
  return "OTHER";
}

export const PSYCHOLOGY_CHECKLIST_KEYS = [
  "definedEntry",
  "definedStop",
  "minimumRr",
  "notRecovering",
  "notChasing",
  "knowHtf",
  "noBlackoutImminent",
  "wouldStillTake",
] as const;

export type PsychologyChecklistKey = (typeof PSYCHOLOGY_CHECKLIST_KEYS)[number];

export type PsychologyChecklist = Record<PsychologyChecklistKey, boolean>;

export const RISK_DEFAULTS = {
  maxRiskPerTradePct: 1,
  maxDailyLossPct: 3,
  maxConsecutiveLosses: 2,
  cooldownAfterLossMinutes: 15,
  minimumRewardRisk: 2,
  maxConcurrentCorrelatedPositions: 1,
  prohibitRiskIncreaseAfterLoss: true,
  prohibitMartingale: true,
  historyLookbackDays: 30,
  accountPollMs: 60_000,
  syncDebounceMs: 10_000,
  blackoutBeforeMinutes: 10,
  blackoutAfterMinutes: 10,
} as const;

export type JournalMatchStatus = "LINKED" | "UNMATCHED" | "UNGATED";

export const JOURNAL_DEFAULTS = {
  matchWindowMs: 4 * 60 * 60 * 1000,
  disciplineStart: 100,
  ungatedPenalty: 30,
  unfollowedPenalty: 20,
  ruleBreakPenalty: 10,
  disciplineThreshold: 70,
  screenshotMaxBytes: 5 * 1024 * 1024,
} as const;

export function isJournalMatchStatus(args: { value: string }): args is { value: JournalMatchStatus } {
  return args.value === "LINKED" || args.value === "UNMATCHED" || args.value === "UNGATED";
}

export function parseJournalMatchStatus(args: { value: string }): JournalMatchStatus | null {
  return isJournalMatchStatus({ value: args.value }) ? (args.value as JournalMatchStatus) : null;
}

export function trendAligned(args: { direction: SignalDirection; primaryTrend: Trend | string | null }): boolean | null {
  if (!args.primaryTrend || args.direction === "NEUTRAL") {
    return null;
  }
  if (args.primaryTrend === "RANGE") {
    return null;
  }
  if (args.direction === "LONG") {
    if (args.primaryTrend === "BULL" || args.primaryTrend === "STRONG_BULL") {
      return true;
    }
    if (args.primaryTrend === "BEAR" || args.primaryTrend === "STRONG_BEAR") {
      return false;
    }
    return null;
  }
  if (args.primaryTrend === "BEAR" || args.primaryTrend === "STRONG_BEAR") {
    return true;
  }
  if (args.primaryTrend === "BULL" || args.primaryTrend === "STRONG_BULL") {
    return false;
  }
  return null;
}

export type RiskProfile = {
  maxRiskPerTradePct: number;
  maxDailyLossPct: number;
  maxConsecutiveLosses: number;
  cooldownAfterLossMinutes: number;
  minimumRewardRisk: number;
  maxConcurrentCorrelatedPositions: number;
  prohibitRiskIncreaseAfterLoss: boolean;
  prohibitMartingale: boolean;
};

export const DEFAULT_RISK_PROFILE: RiskProfile = {
  maxRiskPerTradePct: RISK_DEFAULTS.maxRiskPerTradePct,
  maxDailyLossPct: RISK_DEFAULTS.maxDailyLossPct,
  maxConsecutiveLosses: RISK_DEFAULTS.maxConsecutiveLosses,
  cooldownAfterLossMinutes: RISK_DEFAULTS.cooldownAfterLossMinutes,
  minimumRewardRisk: RISK_DEFAULTS.minimumRewardRisk,
  maxConcurrentCorrelatedPositions: RISK_DEFAULTS.maxConcurrentCorrelatedPositions,
  prohibitRiskIncreaseAfterLoss: RISK_DEFAULTS.prohibitRiskIncreaseAfterLoss,
  prohibitMartingale: RISK_DEFAULTS.prohibitMartingale,
};

export function mergeRiskProfile(args: { raw: unknown }): RiskProfile {
  const value = args.raw && typeof args.raw === "object" ? (args.raw as Record<string, unknown>) : {};
  const numberField = (key: keyof RiskProfile, fallback: number) =>
    typeof value[key] === "number" && Number.isFinite(value[key]) ? (value[key] as number) : fallback;
  const boolField = (key: keyof RiskProfile, fallback: boolean) =>
    typeof value[key] === "boolean" ? (value[key] as boolean) : fallback;
  return {
    maxRiskPerTradePct: numberField("maxRiskPerTradePct", DEFAULT_RISK_PROFILE.maxRiskPerTradePct),
    maxDailyLossPct: numberField("maxDailyLossPct", DEFAULT_RISK_PROFILE.maxDailyLossPct),
    maxConsecutiveLosses: numberField("maxConsecutiveLosses", DEFAULT_RISK_PROFILE.maxConsecutiveLosses),
    cooldownAfterLossMinutes: numberField("cooldownAfterLossMinutes", DEFAULT_RISK_PROFILE.cooldownAfterLossMinutes),
    minimumRewardRisk: numberField("minimumRewardRisk", DEFAULT_RISK_PROFILE.minimumRewardRisk),
    maxConcurrentCorrelatedPositions: numberField(
      "maxConcurrentCorrelatedPositions",
      DEFAULT_RISK_PROFILE.maxConcurrentCorrelatedPositions,
    ),
    prohibitRiskIncreaseAfterLoss: boolField(
      "prohibitRiskIncreaseAfterLoss",
      DEFAULT_RISK_PROFILE.prohibitRiskIncreaseAfterLoss,
    ),
    prohibitMartingale: boolField("prohibitMartingale", DEFAULT_RISK_PROFILE.prohibitMartingale),
  };
}

export type StreamFreshness = "LIVE" | "DELAYED" | "STALE" | "DISCONNECTED";

export type PivotType = "HIGH" | "LOW";

export type SwingLabel = "HH" | "HL" | "LH" | "LL" | "EH" | "EL";

export type StructureLabel = "HH_HL" | "LH_LL" | "MIXED";

export type Trend = "STRONG_BULL" | "BULL" | "RANGE" | "BEAR" | "STRONG_BEAR";

export type Volatility = "LOW" | "NORMAL" | "HIGH" | "EXTREME";

export type Location = "AT_SUPPORT" | "AT_RESISTANCE" | "MID_RANGE" | "EXTENDED_UP" | "EXTENDED_DOWN";

export type ZoneType = "SUPPORT" | "RESISTANCE" | "BOTH";

export type ZoneSource = "AUTO_PIVOT" | "USER_MANUAL" | "PRIOR_DAY" | "PRIOR_WEEK" | "PSYCHOLOGICAL";

export type ZoneStatus = "ACTIVE" | "BROKEN" | "FLIPPED" | "EXPIRED";

export type DomainEventType =
  | "MARKET_TICK_RECEIVED"
  | "CANDLE_UPDATED"
  | "CANDLE_CLOSED"
  | "INDICATORS_UPDATED"
  | "REGIME_UPDATED"
  | "ZONE_UPDATED"
  | "SIGNAL_DETECTED"
  | "SIGNAL_STATE_CHANGED"
  | "ALERT_TRIGGERED"
  | "ACCOUNT_SYNCED"
  | "POSITION_OPENED"
  | "POSITION_UPDATED"
  | "POSITION_CLOSED"
  | "RISK_LIMIT_HIT"
  | "JOURNAL_OPENED"
  | "JOURNAL_BACKFILL";

export {
  ALERT_DEFAULTS,
  ALERT_TYPES,
  DEFAULT_ALERT_SETTINGS,
  M6_STUB_ALERT_TYPES,
  alertAllowedBySettings,
  alertDedupeKey,
  alertHeadline,
  alertSendDecision,
  formatAlertCopy,
  mergeAlertSettings,
  isAlertCooldownActive,
  parseAlertType,
  isM6StubAlertType,
  mapSignalTransitionToAlert,
  mapZoneBreakToAlert,
  scoreCrossedWatch,
  shouldAlertStreamStale,
  shouldEmitAlert,
  shouldPublishStreamStatus,
} from "./alerts.js";
export type { AlertChannel, AlertRecord, AlertSettings, AlertType } from "./alerts.js";
