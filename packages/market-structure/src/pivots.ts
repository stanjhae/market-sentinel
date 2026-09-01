import { Decimal } from "decimal.js";
import { STRUCTURE_DEFAULTS } from "./defaults.js";
import type { ConfirmedPivot, StructureBar } from "./types.js";

export function detectConfirmedPivots(args: {
  candles: StructureBar[];
  leftBars?: number;
  rightBars?: number;
}): ConfirmedPivot[] {
  const leftBars = args.leftBars ?? STRUCTURE_DEFAULTS.leftBars;
  const rightBars = args.rightBars ?? STRUCTURE_DEFAULTS.rightBars;
  const finals = args.candles
    .filter((candle) => candle.isFinal)
    .slice()
    .sort((left, right) => left.openTimeUtc.getTime() - right.openTimeUtc.getTime());
  const pivots: ConfirmedPivot[] = [];

  for (let index = leftBars; index < finals.length - rightBars; index += 1) {
    const candidate = finals[index];
    if (!candidate) {
      continue;
    }
    const left = finals.slice(index - leftBars, index);
    const right = finals.slice(index + 1, index + 1 + rightBars);
    if (left.length < leftBars || right.length < rightBars) {
      continue;
    }
    if (isStrictExtreme({ candidateHigh: candidate.high, neighbors: [...left, ...right], side: "high" })) {
      pivots.push({
        instrumentId: candidate.instrumentId,
        timeframe: candidate.timeframe,
        openTimeUtc: candidate.openTimeUtc,
        type: "HIGH",
        price: new Decimal(candidate.high).toString(),
        leftBars,
        rightBars,
      });
    }
    if (isStrictExtreme({ candidateHigh: candidate.low, neighbors: [...left, ...right], side: "low" })) {
      pivots.push({
        instrumentId: candidate.instrumentId,
        timeframe: candidate.timeframe,
        openTimeUtc: candidate.openTimeUtc,
        type: "LOW",
        price: new Decimal(candidate.low).toString(),
        leftBars,
        rightBars,
      });
    }
  }

  return pivots;
}

function isStrictExtreme(args: {
  candidateHigh: string;
  neighbors: StructureBar[];
  side: "high" | "low";
}): boolean {
  const candidate = new Decimal(args.candidateHigh);
  return args.neighbors.every((neighbor) => {
    const value = new Decimal(args.side === "high" ? neighbor.high : neighbor.low);
    return args.side === "high" ? candidate.gt(value) : candidate.lt(value);
  });
}
