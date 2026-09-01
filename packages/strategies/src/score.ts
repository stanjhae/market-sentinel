import { opportunityLabelFromScore } from "@market-sentinel/domain";
import { Decimal } from "decimal.js";
import { STRATEGY_DEFAULTS } from "./defaults.js";
import type { OpportunityScore, ScoreFactors, StrategyEvaluation, StrategySnapshot } from "./types.js";

function clamp(args: { value: number; max: number }): number {
  if (args.value < 0) {
    return 0;
  }
  if (args.value > args.max) {
    return args.max;
  }
  return args.value;
}

function alignment4h(args: { snapshot: StrategySnapshot; evaluation: StrategyEvaluation }): number {
  const trend = args.snapshot.multiTimeframe.context4h.primaryTrend;
  if (!trend) {
    return 0;
  }
  const bullish = trend === "BULL" || trend === "STRONG_BULL";
  const bearish = trend === "BEAR" || trend === "STRONG_BEAR";
  const aligned =
    (args.evaluation.direction === "LONG" && bullish) ||
    (args.evaluation.direction === "SHORT" && bearish) ||
    args.evaluation.direction === "NEUTRAL";
  if (!aligned) {
    return 0;
  }
  if (trend === "STRONG_BULL" || trend === "STRONG_BEAR") {
    return 20;
  }
  if (trend === "BULL" || trend === "BEAR") {
    return 14;
  }
  return 6;
}

function setup1h(args: { snapshot: StrategySnapshot }): number {
  const setup = args.snapshot.multiTimeframe.setup1h;
  if (setup.continuation || setup.breakdown || setup.breakout) {
    return 15;
  }
  if (setup.pullback || setup.reversal) {
    return 12;
  }
  if (setup.consolidation || setup.structureTransition) {
    return 6;
  }
  return 3;
}

function confluenceSr(args: { snapshot: StrategySnapshot; evaluation: StrategyEvaluation }): number {
  if (args.evaluation.entryZoneLow && args.evaluation.entryZoneHigh) {
    return args.evaluation.target1 ? 20 : 14;
  }
  if (args.snapshot.multiTimeframe.context4h.majorSupport || args.snapshot.multiTimeframe.context4h.majorResistance) {
    return 10;
  }
  return 0;
}

function confirmation15m(args: { snapshot: StrategySnapshot }): number {
  const timing = args.snapshot.multiTimeframe.timing15m;
  const flags = [timing.rejection, timing.reclaim, timing.failedRetest, timing.engulfingImpulse, timing.rsiReset].filter(Boolean).length;
  if (flags >= 3) {
    return 20;
  }
  if (flags === 2) {
    return 14;
  }
  if (flags === 1) {
    return 8;
  }
  return 2;
}

function momentumVol(args: { snapshot: StrategySnapshot }): number {
  const vol = args.snapshot.multiTimeframe.context4h.volatility ?? args.snapshot.regimes["15m"]?.volatility;
  if (vol === "NORMAL") {
    return 10;
  }
  if (vol === "HIGH" || vol === "LOW") {
    return 6;
  }
  if (vol === "EXTREME") {
    return 2;
  }
  return 4;
}

function rewardRiskPoints(args: { evaluation: StrategyEvaluation }): number {
  if (!args.evaluation.riskRewardToT1) {
    return 0;
  }
  const rr = new Decimal(args.evaluation.riskRewardToT1);
  if (rr.gte(3)) {
    return 10;
  }
  if (rr.gte(STRATEGY_DEFAULTS.minRewardRisk)) {
    return 8;
  }
  if (rr.gte("1.5")) {
    return 4;
  }
  return 0;
}

export function scoreOpportunity(args: { snapshot: StrategySnapshot; evaluation: StrategyEvaluation }): OpportunityScore {
  const factors: ScoreFactors = {
    alignment4h: clamp({ value: alignment4h(args), max: 20 }),
    setup1h: clamp({ value: setup1h({ snapshot: args.snapshot }), max: 15 }),
    confluenceSr: clamp({ value: confluenceSr(args), max: 20 }),
    confirmation15m: clamp({ value: confirmation15m({ snapshot: args.snapshot }), max: 20 }),
    momentumVol: clamp({ value: momentumVol({ snapshot: args.snapshot }), max: 10 }),
    rewardRisk: clamp({ value: rewardRiskPoints({ evaluation: args.evaluation }), max: 10 }),
    eventRisk: 5,
  };
  const raw = Object.values(factors).reduce((sum, value) => sum + value, 0);
  const needsZones = args.evaluation.strategyKey !== "do-not-chase";
  const insufficient =
    !args.snapshot.lastFinalClose ||
    !args.snapshot.indicators["15m"]?.atr14 ||
    (needsZones && args.snapshot.zones.length === 0);
  const stale = args.snapshot.streamFreshness === "STALE" || args.snapshot.streamFreshness === "DISCONNECTED";
  const rrBlocked =
    args.evaluation.proposedState === "CONFIRMED" &&
    args.evaluation.direction !== "NEUTRAL" &&
    (!args.evaluation.riskRewardToT1 || new Decimal(args.evaluation.riskRewardToT1).lt(STRATEGY_DEFAULTS.minRewardRisk));
  let blockedReason: string | null = null;
  if (stale) {
    blockedReason = "stale-stream";
  } else if (insufficient) {
    blockedReason = "insufficient-data";
  } else if (rrBlocked) {
    blockedReason = "rr-below-minimum";
  }
  const display = blockedReason ? 0 : raw;
  return {
    raw,
    display,
    label: opportunityLabelFromScore({ score: display }),
    blockedReason,
    factors,
    evidence: {
      stubUntil: "M6",
      hardFilters: ["daily-loss", "consecutive-loss", "cooldown", "news-blackout"],
    },
  };
}
