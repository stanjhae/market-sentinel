import { nearestZone } from "@market-sentinel/market-structure";
import { Decimal } from "decimal.js";
import { STRATEGY_DEFAULTS } from "./defaults.js";
import { atrOf, evaluationFrom, lastBar } from "./helpers.js";
import type { Strategy, StrategySnapshot } from "./types.js";

export function doNotChaseActive(args: { snapshot: StrategySnapshot }): { active: boolean; reason: string | null } {
  const indicators = args.snapshot.indicators["15m"] ?? args.snapshot.indicators[args.snapshot.triggerTimeframe];
  const rsi = indicators?.rsi14;
  const close = new Decimal(args.snapshot.lastFinalClose);
  const atr = atrOf({ snapshot: args.snapshot });
  const bar = lastBar({ bars: args.snapshot.lastBars["15m"] }) ?? lastBar({ bars: args.snapshot.lastBars[args.snapshot.triggerTimeframe] });
  if (rsi && indicators?.bbLower20x2 && new Decimal(rsi).lt(STRATEGY_DEFAULTS.doNotChaseRsiLow) && close.lt(indicators.bbLower20x2)) {
    return { active: true, reason: "rsi-below-bb" };
  }
  if (rsi && indicators?.bbUpper20x2 && new Decimal(rsi).gt(STRATEGY_DEFAULTS.doNotChaseRsiHigh) && close.gt(indicators.bbUpper20x2)) {
    return { active: true, reason: "rsi-above-bb" };
  }
  const impulse = indicators?.trueRange && atr ? new Decimal(indicators.trueRange).div(atr) : bar && atr ? new Decimal(bar.high).minus(bar.low).div(atr) : null;
  const opposing = nearestZone({
    price: args.snapshot.lastFinalClose,
    zones: args.snapshot.zones.filter((zone) => zone.status === "ACTIVE"),
    atr,
  });
  const nearOpposing =
    opposing?.distanceAtr !== null && opposing?.distanceAtr !== undefined
      ? new Decimal(opposing.distanceAtr).lte(STRATEGY_DEFAULTS.retestAtr)
      : false;
  if (impulse && impulse.gt(STRATEGY_DEFAULTS.doNotChaseImpulseAtr) && nearOpposing) {
    return { active: true, reason: "impulse-into-zone" };
  }
  return { active: false, reason: null };
}

export const doNotChaseStrategy: Strategy = {
  key: "do-not-chase",
  version: "1.0.0",
  evaluate(args: { snapshot: StrategySnapshot }) {
    const check = doNotChaseActive({ snapshot: args.snapshot });
    if (check.active) {
      return evaluationFrom({
        strategyKey: "do-not-chase",
        snapshot: args.snapshot,
        direction: "NEUTRAL",
        proposedState: "DETECTED",
        labels: ["DO_NOT_CHASE"],
        evidence: { reason: check.reason },
      });
    }
    return evaluationFrom({
      strategyKey: "do-not-chase",
      snapshot: args.snapshot,
      direction: "NEUTRAL",
      proposedState: "INVALIDATED",
      labels: [],
      evidence: { reason: "clear" },
    });
  },
};
