import type { CanonicalSymbol, SignalDirection, SignalState, StrategyKey, ZoneStatus } from "./index.js";

export const ALERT_TYPES = [
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
] as const;

export type AlertType = (typeof ALERT_TYPES)[number];

export const M6_STUB_ALERT_TYPES = ["RISK_LIMIT_HIT", "POSITION_DETECTED", "POSITION_CLOSED"] as const;

export type AlertChannel = "in_app" | "browser" | "telegram";

export const ALERT_DEFAULTS = {
  scoreThreshold: 70,
  scoreDelta: 10,
  cooldownMinutes: 30,
} as const;

export type AlertSettings = {
  enabled: boolean;
  browserEnabled: boolean;
  telegramEnabled: boolean;
  scoreThreshold: number;
  scoreDelta: number;
  cooldownMinutes: number;
  mutedTypes: AlertType[];
  mutedSymbols: CanonicalSymbol[];
};

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  browserEnabled: true,
  telegramEnabled: true,
  scoreThreshold: ALERT_DEFAULTS.scoreThreshold,
  scoreDelta: ALERT_DEFAULTS.scoreDelta,
  cooldownMinutes: ALERT_DEFAULTS.cooldownMinutes,
  mutedTypes: [],
  mutedSymbols: [],
};

export type AlertRecord = {
  id: string;
  type: AlertType;
  instrumentId: string;
  symbol: string;
  signalId: string | null;
  zoneId: string | null;
  title: string;
  body: string;
  score: number | null;
  direction: SignalDirection | null;
  state: string | null;
  dedupeKey: string;
  channels: AlertChannel[];
  readAt: Date | null;
  createdAt: Date;
};

export function parseAlertType(args: { value: string }): AlertType | null {
  return (ALERT_TYPES as readonly string[]).includes(args.value) ? (args.value as AlertType) : null;
}

export function isM6StubAlertType(args: { type: AlertType }): boolean {
  return (M6_STUB_ALERT_TYPES as readonly AlertType[]).includes(args.type);
}

export function alertDedupeKey(args: {
  type: AlertType;
  instrumentId: string;
  subjectId: string;
  qualifier: string;
}): string {
  return `${args.type}:${args.instrumentId}:${args.subjectId}:${args.qualifier}`;
}

export function shouldEmitAlert(args: { streamGate: "live" | "historical"; type: AlertType | null }): boolean {
  if (args.streamGate === "historical") {
    return false;
  }
  if (!args.type) {
    return false;
  }
  return !isM6StubAlertType({ type: args.type });
}

export function isAlertCooldownActive(args: { lastSentAt: Date | null; now: Date; cooldownMinutes: number }): boolean {
  if (!args.lastSentAt) {
    return false;
  }
  return args.now.getTime() - args.lastSentAt.getTime() < args.cooldownMinutes * 60 * 1000;
}

export function scoreCrossedWatch(args: {
  previousScore: number | null;
  nextScore: number;
  threshold?: number;
  delta?: number;
}): boolean {
  if (args.previousScore === null) {
    return false;
  }
  const threshold = args.threshold ?? ALERT_DEFAULTS.scoreThreshold;
  const delta = args.delta ?? ALERT_DEFAULTS.scoreDelta;
  if (args.nextScore < threshold) {
    return false;
  }
  return args.previousScore < threshold && args.nextScore - args.previousScore >= delta;
}

export function shouldPublishStreamStatus(args: { previousStatus: string | null; nextStatus: string }): boolean {
  return args.previousStatus !== args.nextStatus;
}

export function shouldAlertStreamStale(args: { episodeActive: boolean; nextStatus: string }): {
  emit: boolean;
  episodeActive: boolean;
} {
  if (args.nextStatus !== "STALE") {
    return { emit: false, episodeActive: false };
  }
  if (args.episodeActive) {
    return { emit: false, episodeActive: true };
  }
  return { emit: true, episodeActive: true };
}

export function alertSendDecision(args: {
  settings: AlertSettings;
  type: AlertType;
  symbol: string;
  lastSentAt: Date | null;
  now: Date;
}): "send" | "muted" | "cooldown" {
  if (!alertAllowedBySettings({ settings: args.settings, type: args.type, symbol: args.symbol })) {
    return "muted";
  }
  if (
    isAlertCooldownActive({
      lastSentAt: args.lastSentAt,
      now: args.now,
      cooldownMinutes: args.settings.cooldownMinutes,
    })
  ) {
    return "cooldown";
  }
  return "send";
}

export function mapSignalTransitionToAlert(args: {
  previousState: SignalState | null;
  nextState: SignalState;
  strategyKey: StrategyKey;
}): AlertType | null {
  if (args.nextState === "DISMISSED" || args.nextState === "TRADE_PLANNED") {
    return null;
  }
  if (args.nextState === "EXPIRED" || args.nextState === "ENTERED" || args.nextState === "CLOSED") {
    return null;
  }
  if (args.nextState === "DETECTED" && args.previousState !== "DETECTED") {
    return args.strategyKey === "do-not-chase" ? "DO_NOT_CHASE" : "WATCHLIST_OPPORTUNITY";
  }
  if (args.nextState === "WATCHING" && args.previousState !== "WATCHING") {
    return "RETEST_DETECTED";
  }
  if (args.nextState === "CONFIRMED" && args.previousState !== "CONFIRMED") {
    return "ENTRY_CONFIRMATION";
  }
  if (args.nextState === "INVALIDATED" && args.previousState !== "INVALIDATED") {
    return "SIGNAL_INVALIDATED";
  }
  return null;
}

export function mapZoneBreakToAlert(args: { previousStatus: ZoneStatus; nextStatus: ZoneStatus }): AlertType | null {
  if (args.previousStatus === "ACTIVE" && args.nextStatus === "BROKEN") {
    return "PRICE_ZONE_BROKEN";
  }
  return null;
}

export function formatAlertCopy(args: {
  symbol: string;
  direction: SignalDirection | null;
  headline: string;
  score: number | null;
  context4h?: string | null;
  setup1h?: string | null;
  timing?: string | null;
  entryStatus?: string | null;
  invalidation?: string | null;
  nextLevel?: string | null;
}): { title: string; body: string } {
  const direction = args.direction && args.direction !== "NEUTRAL" ? args.direction : "NEUTRAL";
  const score = args.score === null ? "—" : `${args.score}/100`;
  const title = `${args.symbol} — ${direction} ${args.headline} — ${score}`;
  const parts = [
    args.context4h,
    args.setup1h,
    args.timing,
    args.entryStatus,
    args.invalidation,
    args.nextLevel,
  ].filter((part): part is string => Boolean(part && part.trim()));
  return {
    title,
    body: parts.join(" "),
  };
}

export function alertAllowedBySettings(args: { settings: AlertSettings; type: AlertType; symbol: string }): boolean {
  if (!args.settings.enabled) {
    return false;
  }
  if (args.settings.mutedTypes.includes(args.type)) {
    return false;
  }
  return !args.settings.mutedSymbols.includes(args.symbol as CanonicalSymbol);
}

export function alertHeadline(args: { type: AlertType }): string {
  if (args.type === "WATCHLIST_OPPORTUNITY" || args.type === "RETEST_DETECTED") {
    return "WATCH";
  }
  if (args.type === "ENTRY_CONFIRMATION") {
    return "CONFIRMED";
  }
  if (args.type === "SIGNAL_INVALIDATED") {
    return "INVALIDATED";
  }
  if (args.type === "DO_NOT_CHASE") {
    return "DO NOT CHASE";
  }
  if (args.type === "PRICE_ZONE_BROKEN") {
    return "ZONE BROKEN";
  }
  if (args.type === "MAJOR_LEVEL_APPROACHING") {
    return "LEVEL";
  }
  if (args.type === "STREAM_STALE") {
    return "STALE";
  }
  return args.type.replaceAll("_", " ");
}

export function mergeAlertSettings(args: { raw: unknown }): AlertSettings {
  const value = args.raw && typeof args.raw === "object" ? (args.raw as Record<string, unknown>) : {};
  const mutedTypes = Array.isArray(value.mutedTypes)
    ? value.mutedTypes.filter((item): item is AlertType => typeof item === "string" && parseAlertType({ value: item }) !== null)
    : DEFAULT_ALERT_SETTINGS.mutedTypes;
  const mutedSymbols = Array.isArray(value.mutedSymbols)
    ? value.mutedSymbols.filter((item): item is CanonicalSymbol => typeof item === "string" && ["US30", "US100", "SPX500", "GOLD"].includes(item))
    : DEFAULT_ALERT_SETTINGS.mutedSymbols;
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_ALERT_SETTINGS.enabled,
    browserEnabled: typeof value.browserEnabled === "boolean" ? value.browserEnabled : DEFAULT_ALERT_SETTINGS.browserEnabled,
    telegramEnabled: typeof value.telegramEnabled === "boolean" ? value.telegramEnabled : DEFAULT_ALERT_SETTINGS.telegramEnabled,
    scoreThreshold: typeof value.scoreThreshold === "number" ? value.scoreThreshold : DEFAULT_ALERT_SETTINGS.scoreThreshold,
    scoreDelta: typeof value.scoreDelta === "number" ? value.scoreDelta : DEFAULT_ALERT_SETTINGS.scoreDelta,
    cooldownMinutes: typeof value.cooldownMinutes === "number" ? value.cooldownMinutes : DEFAULT_ALERT_SETTINGS.cooldownMinutes,
    mutedTypes,
    mutedSymbols,
  };
}
