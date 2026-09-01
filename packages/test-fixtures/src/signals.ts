import type { SignalDirection, Trend } from "@market-sentinel/domain";

export type SignalReplayExpected = "NONE" | "DETECTED" | "WATCHING" | "CONFIRMED" | "INVALIDATED";

export type SignalReplayStep = {
  lastClose: string;
  lastHigh: string;
  lastLow: string;
  lastOpen?: string;
  rsi14: string | null;
  previousRsi14?: string | null;
  atr14: string;
  ema20?: string | null;
  bbLower20x2?: string | null;
  bbUpper20x2?: string | null;
  trueRange?: string | null;
  trend4h?: Trend;
  structure1h?: "HH_HL" | "LH_LL" | "MIXED";
  location15m?: "AT_SUPPORT" | "AT_RESISTANCE" | "MID_RANGE" | "EXTENDED_UP" | "EXTENDED_DOWN";
  setup?: Partial<{
    continuation: boolean;
    reversal: boolean;
    breakout: boolean;
    breakdown: boolean;
    pullback: boolean;
    consolidation: boolean;
    structureTransition: boolean;
  }>;
  timing?: Partial<{
    rejection: boolean;
    reclaim: boolean;
    failedRetest: boolean;
    engulfingImpulse: boolean;
    rsiReset: boolean;
    bbMeanReclaim: boolean;
    bbMeanLoss: boolean;
  }>;
  expected: Partial<Record<"breakdown-retest" | "sweep-reclaim" | "trend-pullback" | "do-not-chase", SignalReplayExpected>>;
};

const support = { lowerBound: "100", upperBound: "102", midpoint: "101" };
const nextSupport = { lowerBound: "88", upperBound: "90", midpoint: "89" };
const resistance = { lowerBound: "118", upperBound: "120", midpoint: "119" };

export const SIGNAL_ZONE_LIBRARY = {
  support,
  nextSupport,
  resistance,
} as const;

export function breakdownRetestReplay(): SignalReplayStep[] {
  return [
    {
      lastClose: "99",
      lastHigh: "99.6",
      lastLow: "98.5",
      rsi14: "42",
      atr14: "2",
      trend4h: "BEAR",
      structure1h: "LH_LL",
      setup: { breakdown: true },
      timing: {},
      expected: { "breakdown-retest": "DETECTED" },
    },
    {
      lastClose: "98.5",
      lastHigh: "101.2",
      lastLow: "98",
      rsi14: "40",
      atr14: "2",
      trend4h: "BEAR",
      structure1h: "LH_LL",
      setup: { breakdown: true },
      timing: {},
      expected: { "breakdown-retest": "WATCHING" },
    },
    {
      lastClose: "98.8",
      lastHigh: "101.4",
      lastLow: "98.2",
      rsi14: "38",
      atr14: "2",
      trend4h: "BEAR",
      structure1h: "LH_LL",
      setup: { breakdown: true },
      timing: { rejection: true, failedRetest: true },
      expected: { "breakdown-retest": "CONFIRMED" },
    },
  ];
}

export function falseBreakdownReplay(): SignalReplayStep[] {
  return [
    {
      lastClose: "99",
      lastHigh: "99.6",
      lastLow: "98.5",
      rsi14: "42",
      atr14: "2",
      trend4h: "BEAR",
      structure1h: "LH_LL",
      setup: { breakdown: true },
      timing: {},
      expected: { "breakdown-retest": "DETECTED" },
    },
    {
      lastClose: "103",
      lastHigh: "103.5",
      lastLow: "99",
      rsi14: "48",
      atr14: "2",
      trend4h: "BEAR",
      structure1h: "LH_LL",
      setup: { breakdown: true },
      timing: { reclaim: true },
      expected: { "breakdown-retest": "INVALIDATED" },
    },
  ];
}

export function sweepReclaimReplay(): SignalReplayStep[] {
  return [
    {
      lastClose: "100.4",
      lastHigh: "101.2",
      lastLow: "99.4",
      rsi14: "28",
      previousRsi14: "26",
      atr14: "2",
      trend4h: "BEAR",
      structure1h: "LH_LL",
      location15m: "EXTENDED_DOWN",
      setup: { reversal: true },
      timing: {},
      expected: { "sweep-reclaim": "DETECTED" },
    },
    {
      lastClose: "101.1",
      lastHigh: "101.4",
      lastLow: "100.2",
      rsi14: "28",
      previousRsi14: "29",
      atr14: "2",
      trend4h: "BEAR",
      structure1h: "LH_LL",
      location15m: "AT_SUPPORT",
      setup: { reversal: true },
      timing: { reclaim: true },
      expected: { "sweep-reclaim": "WATCHING" },
    },
    {
      lastClose: "101.6",
      lastHigh: "102",
      lastLow: "100.8",
      rsi14: "36",
      previousRsi14: "32",
      atr14: "2",
      trend4h: "BEAR",
      structure1h: "LH_LL",
      location15m: "AT_SUPPORT",
      setup: { reversal: true },
      timing: { reclaim: true, rsiReset: true },
      expected: { "sweep-reclaim": "CONFIRMED" },
    },
  ];
}

export function trendPullbackReplay(): SignalReplayStep[] {
  return [
    {
      lastClose: "101.2",
      lastHigh: "102",
      lastLow: "100.8",
      rsi14: "45",
      atr14: "2",
      ema20: "101.1",
      trend4h: "BULL",
      structure1h: "HH_HL",
      location15m: "AT_SUPPORT",
      setup: { continuation: true, pullback: true },
      timing: {},
      expected: { "trend-pullback": "DETECTED" },
    },
    {
      lastClose: "101.3",
      lastHigh: "102.1",
      lastLow: "100.9",
      rsi14: "38",
      previousRsi14: "32",
      atr14: "2",
      ema20: "101.1",
      trend4h: "BULL",
      structure1h: "HH_HL",
      location15m: "AT_SUPPORT",
      setup: { continuation: true, pullback: true },
      timing: { rsiReset: true },
      expected: { "trend-pullback": "WATCHING" },
    },
    {
      lastClose: "101.5",
      lastHigh: "102.4",
      lastLow: "100.9",
      rsi14: "42",
      previousRsi14: "38",
      atr14: "2",
      ema20: "101.1",
      trend4h: "BULL",
      structure1h: "HH_HL",
      location15m: "AT_SUPPORT",
      setup: { continuation: true, pullback: true },
      timing: { rsiReset: true, rejection: true },
      expected: { "trend-pullback": "CONFIRMED" },
    },
  ];
}

export function doNotChaseReplay(): SignalReplayStep[] {
  return [
    {
      lastClose: "121",
      lastHigh: "122",
      lastLow: "118",
      rsi14: "78",
      atr14: "2",
      bbUpper20x2: "119",
      trueRange: "4",
      trend4h: "BULL",
      structure1h: "HH_HL",
      location15m: "EXTENDED_UP",
      setup: { continuation: true },
      timing: {},
      expected: { "do-not-chase": "DETECTED", "trend-pullback": "NONE" },
    },
    {
      lastClose: "110",
      lastHigh: "111",
      lastLow: "109",
      rsi14: "55",
      atr14: "2",
      bbUpper20x2: "119",
      bbLower20x2: "90",
      trueRange: "1",
      trend4h: "BULL",
      structure1h: "HH_HL",
      setup: { continuation: true },
      timing: {},
      expected: { "do-not-chase": "INVALIDATED" },
    },
  ];
}

export function replayDirection(args: { name: string }): SignalDirection {
  if (args.name === "sweep-reclaim" || args.name === "trend-pullback") {
    return "LONG";
  }
  if (args.name === "do-not-chase") {
    return "NEUTRAL";
  }
  return "SHORT";
}
