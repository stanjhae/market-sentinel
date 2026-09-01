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
  | "RISK_LIMIT_HIT";
