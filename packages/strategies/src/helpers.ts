import type { SignalDirection, StrategyKey, Timeframe, ZoneType } from "@market-sentinel/domain";
import { isTerminalSignalState, type ProposedSignalState, type SignalState } from "@market-sentinel/domain";
import { closeBreaksZone, type PriceZone, type StructureBar } from "@market-sentinel/market-structure";
import { Decimal } from "decimal.js";
import { STRATEGY_DEFAULTS, STRATEGY_VERSIONS } from "./defaults.js";
import type { StrategyEvaluation, StrategySnapshot } from "./types.js";

export function parameterSnapshot(): Record<string, string> {
  return {
    minRewardRisk: STRATEGY_DEFAULTS.minRewardRisk,
    breakPenetrationAtr: STRATEGY_DEFAULTS.breakPenetrationAtr,
    importantZoneStrength: String(STRATEGY_DEFAULTS.importantZoneStrength),
    retestAtr: STRATEGY_DEFAULTS.retestAtr,
    doNotChaseRsiLow: STRATEGY_DEFAULTS.doNotChaseRsiLow,
    doNotChaseRsiHigh: STRATEGY_DEFAULTS.doNotChaseRsiHigh,
    doNotChaseImpulseAtr: STRATEGY_DEFAULTS.doNotChaseImpulseAtr,
    expiryBars15m: String(STRATEGY_DEFAULTS.expiryBars15m),
  };
}

export function emptyEvaluation(args: {
  strategyKey: StrategyKey;
  snapshot: StrategySnapshot;
  direction?: StrategyEvaluation["direction"];
  evidence?: Record<string, unknown>;
  labels?: string[];
}): StrategyEvaluation {
  return {
    strategyKey: args.strategyKey,
    strategyVersion: STRATEGY_VERSIONS[args.strategyKey],
    direction: args.direction ?? "NEUTRAL",
    proposedState: "NONE",
    labels: args.labels ?? [],
    triggerTimeframe: args.snapshot.triggerTimeframe,
    entryZoneLow: null,
    entryZoneHigh: null,
    invalidationPrice: null,
    target1: null,
    target2: null,
    target3: null,
    riskRewardToT1: null,
    riskRewardToT2: null,
    evidence: args.evidence ?? {},
    parameterSnapshot: parameterSnapshot(),
  };
}

export function lastBar(args: { bars: StructureBar[] | undefined }): StructureBar | null {
  return args.bars?.[args.bars.length - 1] ?? null;
}

export function previousBar(args: { bars: StructureBar[] | undefined }): StructureBar | null {
  return args.bars && args.bars.length > 1 ? (args.bars[args.bars.length - 2] ?? null) : null;
}

export function atrOf(args: { snapshot: StrategySnapshot; timeframe?: Timeframe }): string | null {
  const timeframe = args.timeframe ?? args.snapshot.triggerTimeframe;
  return args.snapshot.indicators[timeframe]?.atr14 ?? args.snapshot.indicators["15m"]?.atr14 ?? null;
}

export function importantZones(args: { zones: PriceZone[]; type?: ZoneType }): PriceZone[] {
  return args.zones.filter((zone) => {
    if (zone.strengthScore < STRATEGY_DEFAULTS.importantZoneStrength) {
      return false;
    }
    if (zone.status !== "ACTIVE" && zone.status !== "BROKEN") {
      return false;
    }
    if (!args.type) {
      return true;
    }
    return zone.type === args.type || zone.type === "BOTH";
  });
}

export function priceNearZone(args: { bar: StructureBar; zone: PriceZone; atr: string | null }): boolean {
  const high = new Decimal(args.bar.high);
  const low = new Decimal(args.bar.low);
  const lower = new Decimal(args.zone.lowerBound);
  const upper = new Decimal(args.zone.upperBound);
  if (high.gte(lower) && low.lte(upper)) {
    return true;
  }
  if (!args.atr || new Decimal(args.atr).eq(0)) {
    return false;
  }
  const pad = new Decimal(args.atr).times(STRATEGY_DEFAULTS.retestAtr);
  return high.plus(pad).gte(lower) && low.minus(pad).lte(upper);
}

export function rewardRisk(args: { entry: string; invalidation: string; target: string }): string | null {
  const risk = new Decimal(args.entry).minus(args.invalidation).abs();
  if (risk.eq(0)) {
    return null;
  }
  return new Decimal(args.target).minus(args.entry).abs().div(risk).toString();
}

export function nextTarget(args: {
  close: string;
  direction: Exclude<SignalDirection, "NEUTRAL">;
  zones: PriceZone[];
  atr: string | null;
}): { zone: PriceZone; midpoint: string } | null {
  const close = new Decimal(args.close);
  const candidates = args.zones
    .filter((zone) => zone.status === "ACTIVE")
    .filter((zone) => {
      if (args.direction === "SHORT") {
        return (zone.type === "SUPPORT" || zone.type === "BOTH") && new Decimal(zone.upperBound).lt(close);
      }
      return (zone.type === "RESISTANCE" || zone.type === "BOTH") && new Decimal(zone.lowerBound).gt(close);
    })
    .sort((left, right) => {
      const leftDist = new Decimal(left.midpoint).minus(close).abs();
      const rightDist = new Decimal(right.midpoint).minus(close).abs();
      return leftDist.cmp(rightDist);
    });
  const zone = candidates[0];
  if (!zone) {
    return null;
  }
  return { zone, midpoint: zone.midpoint };
}

const PROPOSED_RANK: Record<ProposedSignalState, number> = {
  NONE: 0,
  EXPIRED: 1,
  INVALIDATED: 2,
  DETECTED: 3,
  WATCHING: 4,
  CONFIRMED: 5,
};

export function pickPreferredEvaluation(args: {
  left: StrategyEvaluation | null;
  right: StrategyEvaluation | null;
}): StrategyEvaluation | null {
  if (!args.left) {
    return args.right;
  }
  if (!args.right) {
    return args.left;
  }
  const rank = PROPOSED_RANK[args.left.proposedState] - PROPOSED_RANK[args.right.proposedState];
  if (rank !== 0) {
    return rank > 0 ? args.left : args.right;
  }
  const leftRr = args.left.riskRewardToT1 ? new Decimal(args.left.riskRewardToT1) : new Decimal(0);
  const rightRr = args.right.riskRewardToT1 ? new Decimal(args.right.riskRewardToT1) : new Decimal(0);
  return leftRr.gte(rightRr) ? args.left : args.right;
}

export function isTradeSetupStrategy(args: { strategyKey: string }): boolean {
  return args.strategyKey !== "do-not-chase";
}

export function bestOpenTradeSetup<T extends { strategyKey: string; score: number; state: string }>(args: {
  records: T[];
}): T | null {
  return (
    args.records
      .filter(
        (record) =>
          !isTerminalSignalState({ state: record.state as SignalState }) && isTradeSetupStrategy({ strategyKey: record.strategyKey }),
      )
      .slice()
      .sort((left, right) => right.score - left.score)[0] ?? null
  );
}

export function planLevels(args: {
  direction: Exclude<SignalDirection, "NEUTRAL">;
  zone: PriceZone;
  close: string;
  atr: string | null;
  zones: PriceZone[];
}): Pick<
  StrategyEvaluation,
  "entryZoneLow" | "entryZoneHigh" | "invalidationPrice" | "target1" | "target2" | "target3" | "riskRewardToT1" | "riskRewardToT2"
> {
  const penetration = args.atr ? new Decimal(args.atr).times(STRATEGY_DEFAULTS.breakPenetrationAtr) : new Decimal(0);
  const entryZoneLow = args.zone.lowerBound;
  const entryZoneHigh = args.zone.upperBound;
  const invalidationPrice =
    args.direction === "SHORT"
      ? new Decimal(args.zone.upperBound).plus(penetration).toString()
      : new Decimal(args.zone.lowerBound).minus(penetration).toString();
  const first = nextTarget({ close: args.close, direction: args.direction, zones: args.zones.filter((zone) => zone !== args.zone), atr: args.atr });
  const second = first
    ? nextTarget({
        close: first.midpoint,
        direction: args.direction,
        zones: args.zones.filter((zone) => zone !== args.zone && zone !== first.zone),
        atr: args.atr,
      })
    : null;
  const target1 = first?.midpoint ?? null;
  const target2 = second?.midpoint ?? null;
  return {
    entryZoneLow,
    entryZoneHigh,
    invalidationPrice,
    target1,
    target2,
    target3: null,
    riskRewardToT1: target1 ? rewardRisk({ entry: args.close, invalidation: invalidationPrice, target: target1 }) : null,
    riskRewardToT2: target2 ? rewardRisk({ entry: args.close, invalidation: invalidationPrice, target: target2 }) : null,
  };
}

export function rrMeetsMinimum(args: { riskRewardToT1: string | null }): boolean {
  if (!args.riskRewardToT1) {
    return false;
  }
  return new Decimal(args.riskRewardToT1).gte(STRATEGY_DEFAULTS.minRewardRisk);
}

export function brokeBeyond(args: { close: string; zone: PriceZone; atr: string | null; direction: Exclude<SignalDirection, "NEUTRAL"> }): boolean {
  const side = closeBreaksZone({ close: args.close, zone: args.zone, atr: args.atr });
  if (args.direction === "SHORT") {
    return side === "below";
  }
  return side === "above";
}

export function reclaimedThrough(args: { close: string; zone: PriceZone; atr: string | null; direction: Exclude<SignalDirection, "NEUTRAL"> }): boolean {
  const side = closeBreaksZone({ close: args.close, zone: args.zone, atr: args.atr });
  if (args.direction === "SHORT") {
    return side === "above";
  }
  return side === "below";
}

export function evaluationFrom(args: {
  strategyKey: StrategyKey;
  snapshot: StrategySnapshot;
  direction: SignalDirection;
  proposedState: StrategyEvaluation["proposedState"];
  labels?: string[];
  levels?: Pick<
    StrategyEvaluation,
    "entryZoneLow" | "entryZoneHigh" | "invalidationPrice" | "target1" | "target2" | "target3" | "riskRewardToT1" | "riskRewardToT2"
  >;
  evidence: Record<string, unknown>;
}): StrategyEvaluation {
  return {
    ...emptyEvaluation({ strategyKey: args.strategyKey, snapshot: args.snapshot, direction: args.direction }),
    proposedState: args.proposedState,
    labels: args.labels ?? [],
    ...args.levels,
    evidence: args.evidence,
  };
}
