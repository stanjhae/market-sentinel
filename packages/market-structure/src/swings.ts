import type { StructureLabel, SwingLabel } from "@market-sentinel/domain";
import { Decimal } from "decimal.js";
import { STRUCTURE_DEFAULTS } from "./defaults.js";
import type { ConfirmedPivot } from "./types.js";

export function pricesEqual(args: { left: string; right: string; atr: string | null }): boolean {
  const left = new Decimal(args.left);
  const right = new Decimal(args.right);
  if (!args.atr || new Decimal(args.atr).eq(0)) {
    return left.eq(right);
  }
  const tolerance = new Decimal(args.atr).times(STRUCTURE_DEFAULTS.equalToleranceAtr);
  return left.minus(right).abs().lte(tolerance);
}

export function classifySwings(args: {
  pivots: ConfirmedPivot[];
  atr: string | null;
}): Array<{ pivot: ConfirmedPivot; label: SwingLabel }> {
  const highs = args.pivots
    .filter((pivot) => pivot.type === "HIGH")
    .slice()
    .sort((left, right) => left.openTimeUtc.getTime() - right.openTimeUtc.getTime());
  const lows = args.pivots
    .filter((pivot) => pivot.type === "LOW")
    .slice()
    .sort((left, right) => left.openTimeUtc.getTime() - right.openTimeUtc.getTime());

  return [
    ...labelSequence({ pivots: highs, atr: args.atr, high: true }),
    ...labelSequence({ pivots: lows, atr: args.atr, high: false }),
  ].sort((left, right) => left.pivot.openTimeUtc.getTime() - right.pivot.openTimeUtc.getTime());
}

export function structureFromSwings(args: { swings: Array<{ pivot: ConfirmedPivot; label: SwingLabel }> }): StructureLabel {
  const highs = args.swings.filter((item) => item.pivot.type === "HIGH");
  const lows = args.swings.filter((item) => item.pivot.type === "LOW");
  const lastHigh = highs[highs.length - 1]?.label;
  const lastLow = lows[lows.length - 1]?.label;
  if (lastHigh === "HH" && lastLow === "HL") {
    return "HH_HL";
  }
  if (lastHigh === "LH" && lastLow === "LL") {
    return "LH_LL";
  }
  return "MIXED";
}

function labelSequence(args: {
  pivots: ConfirmedPivot[];
  atr: string | null;
  high: boolean;
}): Array<{ pivot: ConfirmedPivot; label: SwingLabel }> {
  return args.pivots.map((pivot, index) => {
    const previous = args.pivots[index - 1];
    if (!previous) {
      return { pivot, label: args.high ? "EH" : "EL" };
    }
    if (pricesEqual({ left: pivot.price, right: previous.price, atr: args.atr })) {
      return { pivot, label: args.high ? "EH" : "EL" };
    }
    const higher = new Decimal(pivot.price).gt(previous.price);
    if (args.high) {
      return { pivot, label: higher ? "HH" : "LH" };
    }
    return { pivot, label: higher ? "HL" : "LL" };
  });
}
