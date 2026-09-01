import type { Location, StructureLabel, SwingLabel, Timeframe, Trend, Volatility } from "@market-sentinel/domain";
import { Decimal } from "decimal.js";
import { STRUCTURE_DEFAULTS } from "./defaults.js";
import { structureFromSwings } from "./swings.js";
import type { ClassifiedSwing, ConfirmedPivot, MarketRegime, PriceZone } from "./types.js";
import { nearestZone } from "./zones.js";

export function classifyTrend(args: { swings: ClassifiedSwing[]; structure: StructureLabel }): Trend {
  if (args.structure === "MIXED") {
    return "RANGE";
  }
  const highs = args.swings.filter((item) => item.pivot.type === "HIGH").map((item) => item.label);
  const lows = args.swings.filter((item) => item.pivot.type === "LOW").map((item) => item.label);
  const strongBull = lastNAgree({ labels: highs, expected: "HH", count: 2 }) && lastNAgree({ labels: lows, expected: "HL", count: 2 });
  const strongBear = lastNAgree({ labels: highs, expected: "LH", count: 2 }) && lastNAgree({ labels: lows, expected: "LL", count: 2 });
  if (args.structure === "HH_HL") {
    return strongBull ? "STRONG_BULL" : "BULL";
  }
  return strongBear ? "STRONG_BEAR" : "BEAR";
}

export function classifyVolatility(args: { atrSeries: Array<string | null> }): Volatility {
  const values = args.atrSeries.filter((value): value is string => Boolean(value)).map((value) => new Decimal(value));
  const current = values[values.length - 1];
  if (!current || values.length < 14) {
    return "NORMAL";
  }
  const lookback = values.slice(-STRUCTURE_DEFAULTS.volatilityLookback);
  const sma = lookback.reduce((sum, value) => sum.plus(value), new Decimal(0)).div(lookback.length);
  if (sma.eq(0)) {
    return "NORMAL";
  }
  const ratio = current.div(sma);
  if (ratio.lt(STRUCTURE_DEFAULTS.volatilityLow)) {
    return "LOW";
  }
  if (ratio.gt(STRUCTURE_DEFAULTS.volatilityExtreme)) {
    return "EXTREME";
  }
  if (ratio.gt(STRUCTURE_DEFAULTS.volatilityHigh)) {
    return "HIGH";
  }
  return "NORMAL";
}

export function classifyLocation(args: { close: string; zones: PriceZone[]; atr: string | null }): Location {
  const support = nearestZone({ price: args.close, zones: args.zones, atr: args.atr, type: "SUPPORT" });
  const resistance = nearestZone({ price: args.close, zones: args.zones, atr: args.atr, type: "RESISTANCE" });
  const supportDist = support?.distanceAtr ? new Decimal(support.distanceAtr) : null;
  const resistanceDist = resistance?.distanceAtr ? new Decimal(resistance.distanceAtr) : null;
  const near = new Decimal(STRUCTURE_DEFAULTS.locationAtr);
  const extended = new Decimal(STRUCTURE_DEFAULTS.extendedAtr);
  if (supportDist && supportDist.lte(near) && (!resistanceDist || supportDist.lte(resistanceDist))) {
    return "AT_SUPPORT";
  }
  if (resistanceDist && resistanceDist.lte(near)) {
    return "AT_RESISTANCE";
  }
  if (resistance && resistanceDist && resistanceDist.gte(extended) && new Decimal(args.close).gt(resistance.zone.upperBound)) {
    return "EXTENDED_UP";
  }
  if (support && supportDist && supportDist.gte(extended) && new Decimal(args.close).lt(support.zone.lowerBound)) {
    return "EXTENDED_DOWN";
  }
  return "MID_RANGE";
}

export function classifyRegime(args: {
  instrumentId: string;
  timeframe: Timeframe;
  timestamp: Date;
  swings: ClassifiedSwing[];
  atrSeries: Array<string | null>;
  close: string;
  zones: PriceZone[];
}): MarketRegime {
  const structure = structureFromSwings({ swings: args.swings });
  const trend = classifyTrend({ swings: args.swings, structure });
  const volatility = classifyVolatility({ atrSeries: args.atrSeries });
  const atr = args.atrSeries[args.atrSeries.length - 1] ?? null;
  const location = classifyLocation({ close: args.close, zones: args.zones, atr });
  const confidence = regimeConfidence({ structure, trend, location, volatility });
  return {
    instrumentId: args.instrumentId,
    timeframe: args.timeframe,
    timestamp: args.timestamp,
    trend,
    structure,
    volatility,
    location,
    confidence,
    evidenceJson: {
      lastHigh: lastSwing({ swings: args.swings, type: "HIGH" }),
      lastLow: lastSwing({ swings: args.swings, type: "LOW" }),
      close: args.close,
      atr,
    },
  };
}

function lastNAgree(args: { labels: SwingLabel[]; expected: SwingLabel; count: number }): boolean {
  if (args.labels.length < args.count) {
    return false;
  }
  return args.labels.slice(-args.count).every((label) => label === args.expected);
}

function regimeConfidence(args: {
  structure: StructureLabel;
  trend: Trend;
  location: Location;
  volatility: Volatility;
}): number {
  let score = 40;
  if (args.structure !== "MIXED") {
    score += 20;
  }
  if (args.trend === "STRONG_BULL" || args.trend === "STRONG_BEAR") {
    score += 15;
  }
  if (args.location === "AT_SUPPORT" || args.location === "AT_RESISTANCE") {
    score += 15;
  }
  if (args.volatility === "NORMAL") {
    score += 10;
  }
  return Math.min(100, score);
}

function lastSwing(args: { swings: ClassifiedSwing[]; type: ConfirmedPivot["type"] }): { label: SwingLabel; price: string } | null {
  const match = args.swings.filter((item) => item.pivot.type === args.type).at(-1);
  return match ? { label: match.label, price: match.pivot.price } : null;
}
