import type { SignalDirection } from "@market-sentinel/domain";
import { closeBreaksZone, type PriceZone } from "@market-sentinel/market-structure";
import { Decimal } from "decimal.js";
import { STRATEGY_DEFAULTS } from "./defaults.js";
import { atrOf, emptyEvaluation, evaluationFrom, importantZones, lastBar, pickPreferredEvaluation, planLevels, previousBar, rrMeetsMinimum } from "./helpers.js";
import type { Strategy, StrategyEvaluation, StrategySnapshot } from "./types.js";

function sweptWithoutClose(args: {
  bar: { high: string; low: string; close: string };
  zone: PriceZone;
  atr: string | null;
  direction: Exclude<SignalDirection, "NEUTRAL">;
}): boolean {
  if (args.direction === "LONG") {
    const wickedBelow = new Decimal(args.bar.low).lt(args.zone.lowerBound);
    const closedBeyond = closeBreaksZone({ close: args.bar.close, zone: args.zone, atr: args.atr }) === "below";
    return wickedBelow && !closedBeyond;
  }
  const wickedAbove = new Decimal(args.bar.high).gt(args.zone.upperBound);
  const closedBeyond = closeBreaksZone({ close: args.bar.close, zone: args.zone, atr: args.atr }) === "above";
  return wickedAbove && !closedBeyond;
}

function stretched(args: { snapshot: StrategySnapshot; direction: Exclude<SignalDirection, "NEUTRAL"> }): boolean {
  const rsi = args.snapshot.indicators["15m"]?.rsi14;
  const location = args.snapshot.regimes["15m"]?.location;
  if (args.direction === "LONG") {
    return (rsi !== null && rsi !== undefined && new Decimal(rsi).lte(STRATEGY_DEFAULTS.rsiTurnOversold)) || location === "EXTENDED_DOWN";
  }
  return (rsi !== null && rsi !== undefined && new Decimal(rsi).gte(STRATEGY_DEFAULTS.rsiTurnOverbought)) || location === "EXTENDED_UP";
}

function rsiTurns(args: { snapshot: StrategySnapshot; direction: Exclude<SignalDirection, "NEUTRAL"> }): boolean {
  const current = args.snapshot.indicators["15m"]?.rsi14;
  const previous = args.snapshot.indicators["15m"]?.previousRsi14;
  if (!current || !previous) {
    return false;
  }
  if (args.direction === "LONG") {
    return new Decimal(current).gt(previous);
  }
  return new Decimal(current).lt(previous);
}

function findSweepMatch(args: {
  zones: PriceZone[];
  recent: Array<{ high: string; low: string; close: string }>;
  previous: { high: string; low: string; close: string } | null;
  bar: { high: string; low: string; close: string };
  atr: string | null;
  direction: Exclude<SignalDirection, "NEUTRAL">;
}): { zone: PriceZone; sweepExtreme: string } | null {
  for (const zone of args.zones) {
    const sweepBar = [...args.recent]
      .reverse()
      .find((candidate) => sweptWithoutClose({ bar: candidate, zone, atr: args.atr, direction: args.direction }));
    if (sweepBar) {
      return {
        zone,
        sweepExtreme: args.direction === "LONG" ? sweepBar.low : sweepBar.high,
      };
    }
    const quickReclaim =
      args.previous !== null &&
      closeBreaksZone({ close: args.previous.close, zone, atr: args.atr }) === (args.direction === "LONG" ? "below" : "above") &&
      closeBreaksZone({ close: args.bar.close, zone, atr: args.atr }) === null;
    if (quickReclaim && args.previous) {
      return {
        zone,
        sweepExtreme: args.direction === "LONG" ? args.previous.low : args.previous.high,
      };
    }
  }
  return null;
}

function closedThrough(args: {
  close: string;
  zone: { midpoint: string; upperBound: string; lowerBound: string };
  direction: Exclude<SignalDirection, "NEUTRAL">;
}): boolean {
  if (args.direction === "LONG") {
    return new Decimal(args.close).gte(args.zone.midpoint);
  }
  return new Decimal(args.close).lte(args.zone.midpoint);
}

export function evaluateSweepReclaimDirection(args: {
  snapshot: StrategySnapshot;
  direction: Exclude<SignalDirection, "NEUTRAL">;
}): StrategyEvaluation | null {
  const zoneType = args.direction === "LONG" ? "SUPPORT" : "RESISTANCE";
  const zones = importantZones({ zones: args.snapshot.zones, type: zoneType });
  const atr = atrOf({ snapshot: args.snapshot });
  const bars = args.snapshot.lastBars["15m"] ?? args.snapshot.lastBars[args.snapshot.triggerTimeframe] ?? [];
  const bar = lastBar({ bars });
  const previous = previousBar({ bars });
  if (!bar) {
    return null;
  }
  const recent = bars.slice(-4);
  const match = findSweepMatch({
    zones,
    recent,
    previous,
    bar,
    atr,
    direction: args.direction,
  });
  if (!match || !stretched({ snapshot: args.snapshot, direction: args.direction })) {
    return null;
  }
  const { zone, sweepExtreme } = match;
  const levels = planLevels({
    direction: args.direction,
    zone,
    close: args.snapshot.lastFinalClose,
    atr,
    zones: args.snapshot.zones,
  });
  const labels =
    args.direction === "LONG"
      ? args.snapshot.multiTimeframe.context4h.primaryTrend === "BEAR" ||
        args.snapshot.multiTimeframe.context4h.primaryTrend === "STRONG_BEAR" ||
        args.snapshot.regimes["1h"]?.structure === "LH_LL"
        ? ["COUNTERTREND"]
        : []
      : args.snapshot.multiTimeframe.context4h.primaryTrend === "BULL" ||
          args.snapshot.multiTimeframe.context4h.primaryTrend === "STRONG_BULL" ||
          args.snapshot.regimes["1h"]?.structure === "HH_HL"
        ? ["COUNTERTREND"]
        : [];
  const lostExtreme =
    args.direction === "LONG"
      ? new Decimal(args.snapshot.lastFinalClose).lt(sweepExtreme)
      : new Decimal(args.snapshot.lastFinalClose).gt(sweepExtreme);
  if (lostExtreme) {
    return evaluationFrom({
      strategyKey: "sweep-reclaim",
      snapshot: args.snapshot,
      direction: args.direction,
      proposedState: "INVALIDATED",
      labels,
      levels,
      evidence: { zoneId: zone.id ?? null, reason: "sweep-extreme-lost", sweepExtreme },
    });
  }
  const timing = args.snapshot.multiTimeframe.timing15m;
  const improving = timing.reclaim || timing.rejection || timing.rsiReset;
  if (
    closedThrough({ close: bar.close, zone, direction: args.direction }) &&
    improving &&
    rsiTurns({ snapshot: args.snapshot, direction: args.direction }) &&
    rrMeetsMinimum({ riskRewardToT1: levels.riskRewardToT1 })
  ) {
    return evaluationFrom({
      strategyKey: "sweep-reclaim",
      snapshot: args.snapshot,
      direction: args.direction,
      proposedState: "CONFIRMED",
      labels,
      levels,
      evidence: { zoneId: zone.id ?? null, reason: "reclaim-rsi-turn", rr: levels.riskRewardToT1 },
    });
  }
  if (closedThrough({ close: bar.close, zone, direction: args.direction }) || timing.reclaim) {
    return evaluationFrom({
      strategyKey: "sweep-reclaim",
      snapshot: args.snapshot,
      direction: args.direction,
      proposedState: "WATCHING",
      labels,
      levels,
      evidence: { zoneId: zone.id ?? null, reason: "await-confirm" },
    });
  }
  return evaluationFrom({
    strategyKey: "sweep-reclaim",
    snapshot: args.snapshot,
    direction: args.direction,
    proposedState: "DETECTED",
    labels,
    levels,
    evidence: { zoneId: zone.id ?? null, reason: "sweep" },
  });
}

export const sweepReclaimStrategy: Strategy = {
  key: "sweep-reclaim",
  version: "1.0.0",
  evaluate(args: { snapshot: StrategySnapshot }): StrategyEvaluation {
    const long = evaluateSweepReclaimDirection({ snapshot: args.snapshot, direction: "LONG" });
    const short = evaluateSweepReclaimDirection({ snapshot: args.snapshot, direction: "SHORT" });
    return (
      pickPreferredEvaluation({ left: long, right: short }) ?? emptyEvaluation({ strategyKey: "sweep-reclaim", snapshot: args.snapshot })
    );
  },
};
