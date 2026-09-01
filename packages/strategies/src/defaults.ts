import { STRUCTURE_DEFAULTS } from "@market-sentinel/market-structure";

export const STRATEGY_DEFAULTS = {
  minRewardRisk: "2.0",
  breakPenetrationAtr: STRUCTURE_DEFAULTS.breakPenetrationAtr,
  importantZoneStrength: 40,
  retestAtr: "0.25",
  doNotChaseRsiLow: "25",
  doNotChaseRsiHigh: "75",
  doNotChaseImpulseAtr: "1.5",
  expiryBars15m: 48,
  rsiTurnOversold: "40",
  rsiTurnOverbought: "60",
} as const;

export const STRATEGY_VERSIONS = {
  "breakdown-retest": "1.0.0",
  "sweep-reclaim": "1.0.0",
  "trend-pullback": "1.0.0",
  "do-not-chase": "1.0.0",
} as const;
