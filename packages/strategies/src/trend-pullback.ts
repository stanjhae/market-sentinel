import type { SignalDirection } from "@market-sentinel/domain";
import { Decimal } from "decimal.js";
import { STRATEGY_DEFAULTS } from "./defaults.js";
import { atrOf, emptyEvaluation, evaluationFrom, importantZones, lastBar, pickPreferredEvaluation, planLevels, priceNearZone, rrMeetsMinimum } from "./helpers.js";
import type { Strategy, StrategyEvaluation, StrategySnapshot } from "./types.js";

function aligned(args: { snapshot: StrategySnapshot; direction: Exclude<SignalDirection, "NEUTRAL"> }): boolean {
  const trend = args.snapshot.multiTimeframe.context4h.primaryTrend;
  const setup = args.snapshot.multiTimeframe.setup1h;
  if (args.direction === "LONG") {
    return (trend === "BULL" || trend === "STRONG_BULL") && (setup.continuation || setup.pullback);
  }
  return (trend === "BEAR" || trend === "STRONG_BEAR") && (setup.continuation || setup.pullback);
}

function pulledBack(args: { snapshot: StrategySnapshot; direction: Exclude<SignalDirection, "NEUTRAL"> }): boolean {
  const location = args.snapshot.regimes["1h"]?.location;
  const indicators = args.snapshot.indicators["15m"] ?? args.snapshot.indicators["1h"];
  const close = new Decimal(args.snapshot.lastFinalClose);
  const atr = atrOf({ snapshot: args.snapshot });
  const nearEma =
    indicators?.ema20 && atr
      ? close.minus(indicators.ema20).abs().lte(new Decimal(atr).times(STRATEGY_DEFAULTS.retestAtr))
      : false;
  const nearEma50 =
    indicators?.ema50 && atr
      ? close.minus(indicators.ema50).abs().lte(new Decimal(atr).times(STRATEGY_DEFAULTS.retestAtr))
      : false;
  if (args.direction === "LONG") {
    return location === "AT_SUPPORT" || args.snapshot.multiTimeframe.setup1h.pullback || nearEma || nearEma50;
  }
  return location === "AT_RESISTANCE" || args.snapshot.multiTimeframe.setup1h.pullback || nearEma || nearEma50;
}

function structureFlipped(args: { snapshot: StrategySnapshot; direction: Exclude<SignalDirection, "NEUTRAL"> }): boolean {
  const trend = args.snapshot.multiTimeframe.context4h.primaryTrend;
  if (args.direction === "LONG") {
    return trend === "BEAR" || trend === "STRONG_BEAR";
  }
  return trend === "BULL" || trend === "STRONG_BULL";
}

export function evaluateTrendPullbackDirection(args: {
  snapshot: StrategySnapshot;
  direction: Exclude<SignalDirection, "NEUTRAL">;
}): StrategyEvaluation | null {
  if (!aligned({ snapshot: args.snapshot, direction: args.direction }) && !structureFlipped({ snapshot: args.snapshot, direction: args.direction })) {
    return null;
  }
  if (!pulledBack({ snapshot: args.snapshot, direction: args.direction }) && !structureFlipped({ snapshot: args.snapshot, direction: args.direction })) {
    return null;
  }
  const zoneType = args.direction === "LONG" ? "SUPPORT" : "RESISTANCE";
  const zone =
    importantZones({ zones: args.snapshot.zones, type: zoneType })[0] ??
    args.snapshot.zones.find((item) => item.type === zoneType || item.type === "BOTH") ??
    null;
  const atr = atrOf({ snapshot: args.snapshot });
  const levels = zone
    ? planLevels({
        direction: args.direction,
        zone,
        close: args.snapshot.lastFinalClose,
        atr,
        zones: args.snapshot.zones,
      })
    : undefined;
  if (structureFlipped({ snapshot: args.snapshot, direction: args.direction })) {
    return evaluationFrom({
      strategyKey: "trend-pullback",
      snapshot: args.snapshot,
      direction: args.direction,
      proposedState: "INVALIDATED",
      levels,
      evidence: { reason: "4h-flip" },
    });
  }
  const timing = args.snapshot.multiTimeframe.timing15m;
  const bar = lastBar({ bars: args.snapshot.lastBars["15m"] });
  const nearZone = zone && bar ? priceNearZone({ bar, zone, atr }) : args.snapshot.multiTimeframe.setup1h.pullback;
  if ((timing.rejection || timing.reclaim || timing.engulfingImpulse) && timing.rsiReset && rrMeetsMinimum({ riskRewardToT1: levels?.riskRewardToT1 ?? null }) && nearZone) {
    return evaluationFrom({
      strategyKey: "trend-pullback",
      snapshot: args.snapshot,
      direction: args.direction,
      proposedState: "CONFIRMED",
      levels,
      evidence: { reason: "reset-reclaim", rr: levels?.riskRewardToT1 ?? null },
    });
  }
  if (timing.rsiReset) {
    return evaluationFrom({
      strategyKey: "trend-pullback",
      snapshot: args.snapshot,
      direction: args.direction,
      proposedState: "WATCHING",
      levels,
      evidence: { reason: "rsi-reset" },
    });
  }
  return evaluationFrom({
    strategyKey: "trend-pullback",
    snapshot: args.snapshot,
    direction: args.direction,
    proposedState: "DETECTED",
    levels,
    evidence: { reason: "aligned-pullback" },
  });
}

export const trendPullbackStrategy: Strategy = {
  key: "trend-pullback",
  version: "1.0.0",
  evaluate(args: { snapshot: StrategySnapshot }): StrategyEvaluation {
    const long = evaluateTrendPullbackDirection({ snapshot: args.snapshot, direction: "LONG" });
    const short = evaluateTrendPullbackDirection({ snapshot: args.snapshot, direction: "SHORT" });
    return pickPreferredEvaluation({ left: long, right: short }) ?? emptyEvaluation({ strategyKey: "trend-pullback", snapshot: args.snapshot });
  },
};
