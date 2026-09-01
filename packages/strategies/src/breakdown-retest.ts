import type { SignalDirection } from "@market-sentinel/domain";
import { Decimal } from "decimal.js";
import { lastBar, atrOf, brokeBeyond, emptyEvaluation, evaluationFrom, importantZones, pickPreferredEvaluation, planLevels, previousBar, reclaimedThrough, rrMeetsMinimum } from "./helpers.js";
import type { Strategy, StrategyEvaluation, StrategySnapshot } from "./types.js";

function directionalContext(args: { snapshot: StrategySnapshot; direction: Exclude<SignalDirection, "NEUTRAL"> }): boolean {
  const setup = args.snapshot.multiTimeframe.setup1h;
  const trend = args.snapshot.multiTimeframe.context4h.primaryTrend;
  if (args.direction === "SHORT") {
    return setup.breakdown || trend === "BEAR" || trend === "STRONG_BEAR" || args.snapshot.regimes["1h"]?.structure === "LH_LL";
  }
  return setup.breakout || trend === "BULL" || trend === "STRONG_BULL" || args.snapshot.regimes["1h"]?.structure === "HH_HL";
}

export function evaluateBreakdownRetestDirection(args: {
  snapshot: StrategySnapshot;
  direction: Exclude<SignalDirection, "NEUTRAL">;
}): StrategyEvaluation | null {
  const zoneType = args.direction === "SHORT" ? "SUPPORT" : "RESISTANCE";
  const zones = importantZones({ zones: args.snapshot.zones, type: zoneType });
  const atr = atrOf({ snapshot: args.snapshot });
  const bar15 = lastBar({ bars: args.snapshot.lastBars["15m"] });
  const bar1h = lastBar({ bars: args.snapshot.lastBars["1h"] });
  const prev15 = previousBar({ bars: args.snapshot.lastBars["15m"] });
  const close = args.snapshot.lastFinalClose;
  const broken = zones.find((zone) => {
    const currentBreak =
      (bar15 ? brokeBeyond({ close: bar15.close, zone, atr, direction: args.direction }) : false) ||
      (bar1h ? brokeBeyond({ close: bar1h.close, zone, atr, direction: args.direction }) : false) ||
      brokeBeyond({ close, zone, atr, direction: args.direction });
    const previousBreak = prev15 ? brokeBeyond({ close: prev15.close, zone, atr, direction: args.direction }) : false;
    return currentBreak || previousBreak || zone.status === "BROKEN";
  });
  if (!broken || !directionalContext({ snapshot: args.snapshot, direction: args.direction })) {
    return null;
  }
  const levels = planLevels({
    direction: args.direction,
    zone: broken,
    close,
    atr,
    zones: args.snapshot.zones,
  });
  const timing = args.snapshot.multiTimeframe.timing15m;
  if (reclaimedThrough({ close, zone: broken, atr, direction: args.direction })) {
    return evaluationFrom({
      strategyKey: "breakdown-retest",
      snapshot: args.snapshot,
      direction: args.direction,
      proposedState: "INVALIDATED",
      levels,
      evidence: { zoneId: broken.id ?? null, reason: "reclaim" },
    });
  }
  const probe = bar15 ?? bar1h;
  const stillBeyond = brokeBeyond({ close, zone: broken, atr, direction: args.direction });
  const retesting = Boolean(
    probe &&
      stillBeyond &&
      new Decimal(probe.high).gte(broken.lowerBound) &&
      new Decimal(probe.low).lte(broken.upperBound),
  );
  const rejected = timing.rejection || timing.failedRetest || timing.engulfingImpulse;
  if (retesting && rejected && rrMeetsMinimum({ riskRewardToT1: levels.riskRewardToT1 })) {
    return evaluationFrom({
      strategyKey: "breakdown-retest",
      snapshot: args.snapshot,
      direction: args.direction,
      proposedState: "CONFIRMED",
      levels,
      evidence: { zoneId: broken.id ?? null, reason: "retest-reject", rr: levels.riskRewardToT1 },
    });
  }
  if (retesting || (stillBeyond && (broken.status === "BROKEN" || Boolean(prev15 && brokeBeyond({ close: prev15.close, zone: broken, atr, direction: args.direction }))))) {
    return evaluationFrom({
      strategyKey: "breakdown-retest",
      snapshot: args.snapshot,
      direction: args.direction,
      proposedState: "WATCHING",
      levels,
      evidence: { zoneId: broken.id ?? null, reason: "await-retest", retesting },
    });
  }
  return evaluationFrom({
    strategyKey: "breakdown-retest",
    snapshot: args.snapshot,
    direction: args.direction,
    proposedState: "DETECTED",
    levels,
    evidence: { zoneId: broken.id ?? null, reason: "close-beyond" },
  });
}

export const breakdownRetestStrategy: Strategy = {
  key: "breakdown-retest",
  version: "1.0.0",
  evaluate(args: { snapshot: StrategySnapshot }): StrategyEvaluation {
    const long = evaluateBreakdownRetestDirection({ snapshot: args.snapshot, direction: "LONG" });
    const short = evaluateBreakdownRetestDirection({ snapshot: args.snapshot, direction: "SHORT" });
    return (
      pickPreferredEvaluation({ left: long, right: short }) ??
      emptyEvaluation({ strategyKey: "breakdown-retest", snapshot: args.snapshot })
    );
  },
};
