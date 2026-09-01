import { breakdownRetestStrategy, evaluateBreakdownRetestDirection } from "./breakdown-retest.js";
import { doNotChaseActive, doNotChaseStrategy } from "./do-not-chase.js";
import { emptyEvaluation } from "./helpers.js";
import { evaluateSweepReclaimDirection, sweepReclaimStrategy } from "./sweep-reclaim.js";
import { evaluateTrendPullbackDirection, trendPullbackStrategy } from "./trend-pullback.js";
import type { Strategy, StrategyEvaluation, StrategySnapshot } from "./types.js";

export const STRATEGIES: Strategy[] = [breakdownRetestStrategy, sweepReclaimStrategy, trendPullbackStrategy, doNotChaseStrategy];

function directionalPair(args: {
  strategyKey: StrategyEvaluation["strategyKey"];
  snapshot: StrategySnapshot;
  long: StrategyEvaluation | null;
  short: StrategyEvaluation | null;
  evidence?: Record<string, unknown>;
}): StrategyEvaluation[] {
  return [
    args.long ?? emptyEvaluation({ strategyKey: args.strategyKey, snapshot: args.snapshot, direction: "LONG", evidence: args.evidence }),
    args.short ??
      emptyEvaluation({ strategyKey: args.strategyKey, snapshot: args.snapshot, direction: "SHORT", evidence: args.evidence }),
  ];
}

export function evaluateAllStrategies(args: { snapshot: StrategySnapshot }): StrategyEvaluation[] {
  const chase = doNotChaseActive({ snapshot: args.snapshot });
  const timing = args.snapshot.multiTimeframe.timing15m;
  const allowContinuation = !chase.active || timing.rsiReset || timing.reclaim || timing.failedRetest;
  const pullback = allowContinuation
    ? directionalPair({
        strategyKey: "trend-pullback",
        snapshot: args.snapshot,
        long: evaluateTrendPullbackDirection({ snapshot: args.snapshot, direction: "LONG" }),
        short: evaluateTrendPullbackDirection({ snapshot: args.snapshot, direction: "SHORT" }),
      })
    : directionalPair({
        strategyKey: "trend-pullback",
        snapshot: args.snapshot,
        long: null,
        short: null,
        evidence: { suppressedBy: "DO_NOT_CHASE" },
      });
  return [
    ...directionalPair({
      strategyKey: "breakdown-retest",
      snapshot: args.snapshot,
      long: evaluateBreakdownRetestDirection({ snapshot: args.snapshot, direction: "LONG" }),
      short: evaluateBreakdownRetestDirection({ snapshot: args.snapshot, direction: "SHORT" }),
    }),
    ...directionalPair({
      strategyKey: "sweep-reclaim",
      snapshot: args.snapshot,
      long: evaluateSweepReclaimDirection({ snapshot: args.snapshot, direction: "LONG" }),
      short: evaluateSweepReclaimDirection({ snapshot: args.snapshot, direction: "SHORT" }),
    }),
    ...pullback,
    doNotChaseStrategy.evaluate({ snapshot: args.snapshot }),
  ];
}
