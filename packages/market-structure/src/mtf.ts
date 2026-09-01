import type { StructureLabel, Timeframe } from "@market-sentinel/domain";
import { candleGeometry } from "@market-sentinel/indicators";
import { Decimal } from "decimal.js";
import { STRUCTURE_DEFAULTS } from "./defaults.js";
import type { MarketRegime, MultiTimeframeContext, PriceZone, SetupFlags, StructureBar, TimingFlags } from "./types.js";
import { closeBreaksZone, nearestZone } from "./zones.js";

export type TimingIndicators = {
  rsi14: string | null;
  previousRsi14?: string | null;
  atr14: string | null;
  bbBasis20: string | null;
  bbUpper20x2: string | null;
  bbLower20x2: string | null;
};

export function classifyTiming15m(args: {
  bars: StructureBar[];
  indicators: TimingIndicators;
  zones: PriceZone[];
}): TimingFlags {
  const last = args.bars[args.bars.length - 1];
  const previous = args.bars[args.bars.length - 2];
  if (!last || !last.isFinal) {
    return emptyTiming();
  }
  const geometry = candleGeometry({
    bar: { open: last.open, high: last.high, low: last.low, close: last.close },
  });
  const atr = args.indicators.atr14;
  const nearest = nearestZone({ price: last.close, zones: args.zones, atr });
  const upperWick = geometry.upperWickRatio ? new Decimal(geometry.upperWickRatio.toString()) : new Decimal(0);
  const lowerWick = geometry.lowerWickRatio ? new Decimal(geometry.lowerWickRatio.toString()) : new Decimal(0);
  const rejectionRatio = new Decimal(STRUCTURE_DEFAULTS.wickRejectionRatio);
  const rejection = classifyRejection({
    last,
    nearest: nearest?.zone ?? null,
    upperWick,
    lowerWick,
    rejectionRatio,
  });
  const previousBeyond = previous && nearest ? closeBreaksZone({ close: previous.close, zone: nearest.zone, atr }) : null;
  const lastBeyond = nearest ? closeBreaksZone({ close: last.close, zone: nearest.zone, atr }) : null;
  const lastTouches =
    nearest && new Decimal(last.high).gte(nearest.zone.lowerBound) && new Decimal(last.low).lte(nearest.zone.upperBound);
  const reclaim = Boolean(previousBeyond && !lastBeyond && nearest);
  const failedRetest = Boolean(previousBeyond && lastBeyond && lastTouches);
  const lastBodyLow = Decimal.min(last.open, last.close);
  const lastBodyHigh = Decimal.max(last.open, last.close);
  const previousBodyLow = previous ? Decimal.min(previous.open, previous.close) : null;
  const previousBodyHigh = previous ? Decimal.max(previous.open, previous.close) : null;
  const engulfingImpulse = Boolean(
    previous &&
      previousBodyLow &&
      previousBodyHigh &&
      lastBodyLow.lte(previousBodyLow) &&
      lastBodyHigh.gte(previousBodyHigh) &&
      atr &&
      geometry.bodySize.gte(new Decimal(atr).times(STRUCTURE_DEFAULTS.engulfingBodyAtr)),
  );
  const previousRsi = args.indicators.previousRsi14 ? new Decimal(args.indicators.previousRsi14) : null;
  const rsi = args.indicators.rsi14 ? new Decimal(args.indicators.rsi14) : null;
  const rsiReset = Boolean(
    previousRsi &&
      rsi &&
      ((previousRsi.lte(STRUCTURE_DEFAULTS.rsiResetOversold) && rsi.gt(STRUCTURE_DEFAULTS.rsiResetOversoldExit)) ||
        (previousRsi.gte(STRUCTURE_DEFAULTS.rsiResetOverbought) && rsi.lt(STRUCTURE_DEFAULTS.rsiResetOverboughtExit))),
  );
  const previousClose = previous?.close ?? null;
  const bbMeanReclaim = bandCross({
    previousClose,
    lastClose: last.close,
    upper: args.indicators.bbUpper20x2,
    lower: args.indicators.bbLower20x2,
    reclaim: true,
  });
  const bbMeanLoss = bandCross({
    previousClose,
    lastClose: last.close,
    upper: args.indicators.bbUpper20x2,
    lower: args.indicators.bbLower20x2,
    reclaim: false,
  });
  return {
    rejection,
    reclaim,
    failedRetest,
    engulfingImpulse,
    rsiReset,
    bbMeanReclaim,
    bbMeanLoss,
  };
}

export function classifySetup1h(args: {
  regime: MarketRegime | null;
  previousStructure: StructureLabel | null;
  close: string;
  zones: PriceZone[];
  atr: string | null;
}): SetupFlags {
  const structure = args.regime?.structure ?? "MIXED";
  const trend = args.regime?.trend ?? "RANGE";
  const location = args.regime?.location ?? "MID_RANGE";
  const volatility = args.regime?.volatility ?? "NORMAL";
  const bullish = trend === "BULL" || trend === "STRONG_BULL";
  const bearish = trend === "BEAR" || trend === "STRONG_BEAR";
  const resistance = nearestZone({ price: args.close, zones: args.zones, atr: args.atr, type: "RESISTANCE" });
  const support = nearestZone({ price: args.close, zones: args.zones, atr: args.atr, type: "SUPPORT" });
  return {
    continuation: (structure === "HH_HL" && bullish) || (structure === "LH_LL" && bearish),
    reversal: (location === "AT_RESISTANCE" && structure !== "HH_HL") || (location === "AT_SUPPORT" && structure !== "LH_LL"),
    breakout: Boolean(
      resistance && closeBreaksZone({ close: args.close, zone: resistance.zone, atr: args.atr }) === "above",
    ),
    breakdown: Boolean(
      support && closeBreaksZone({ close: args.close, zone: support.zone, atr: args.atr }) === "below",
    ),
    pullback: (bullish && location === "AT_SUPPORT") || (bearish && location === "AT_RESISTANCE"),
    consolidation: structure === "MIXED" && volatility === "LOW",
    structureTransition: Boolean(args.previousStructure && args.previousStructure !== structure),
  };
}

export function buildMultiTimeframeContext(args: {
  regimes: Partial<Record<Timeframe, MarketRegime | null>>;
  zones: PriceZone[];
  bars15m: StructureBar[];
  indicators15m: TimingIndicators;
  close1h: string | null;
  atr1h: string | null;
  previousStructure1h: StructureLabel | null;
}): MultiTimeframeContext {
  const regime4h = args.regimes["4h"] ?? null;
  const regime1h = args.regimes["1h"] ?? null;
  const support = nearestZone({
    price: args.close1h ?? "0",
    zones: args.zones.filter((zone) => zone.timeframe === "4h" || zone.timeframe === "1h"),
    atr: args.atr1h,
    type: "SUPPORT",
  });
  const resistance = nearestZone({
    price: args.close1h ?? "0",
    zones: args.zones.filter((zone) => zone.timeframe === "4h" || zone.timeframe === "1h"),
    atr: args.atr1h,
    type: "RESISTANCE",
  });
  return {
    context4h: {
      primaryTrend: regime4h?.trend ?? null,
      majorSupport: support?.zone.midpoint ?? null,
      majorResistance: resistance?.zone.midpoint ?? null,
      extended: regime4h?.location === "EXTENDED_UP" || regime4h?.location === "EXTENDED_DOWN",
      volatility: regime4h?.volatility ?? null,
    },
    setup1h: classifySetup1h({
      regime: regime1h,
      previousStructure: args.previousStructure1h,
      close: args.close1h ?? "0",
      zones: args.zones.filter((zone) => zone.timeframe === "1h"),
      atr: args.atr1h,
    }),
    timing15m: classifyTiming15m({
      bars: args.bars15m.filter((bar) => bar.isFinal).slice(-3),
      indicators: args.indicators15m,
      zones: args.zones.filter((zone) => zone.timeframe === "15m"),
    }),
  };
}

function classifyRejection(args: {
  last: StructureBar;
  nearest: PriceZone | null;
  upperWick: Decimal;
  lowerWick: Decimal;
  rejectionRatio: Decimal;
}): boolean {
  if (args.nearest) {
    if (args.nearest.type === "RESISTANCE" || args.nearest.type === "BOTH") {
      return args.upperWick.gte(args.rejectionRatio) && new Decimal(args.last.close).lte(args.nearest.upperBound);
    }
    if (args.nearest.type === "SUPPORT") {
      return args.lowerWick.gte(args.rejectionRatio) && new Decimal(args.last.close).gte(args.nearest.lowerBound);
    }
  }
  const mid = new Decimal(args.last.high).plus(args.last.low).div(2);
  if (args.upperWick.gte(args.rejectionRatio)) {
    return new Decimal(args.last.close).lte(mid);
  }
  if (args.lowerWick.gte(args.rejectionRatio)) {
    return new Decimal(args.last.close).gte(mid);
  }
  return false;
}

function bandCross(args: {
  previousClose: string | null;
  lastClose: string;
  upper: string | null;
  lower: string | null;
  reclaim: boolean;
}): boolean {
  if (!args.previousClose || !args.upper || !args.lower) {
    return false;
  }
  const previous = new Decimal(args.previousClose);
  const last = new Decimal(args.lastClose);
  const upper = new Decimal(args.upper);
  const lower = new Decimal(args.lower);
  const prevOutside = previous.gt(upper) || previous.lt(lower);
  const lastInside = last.lte(upper) && last.gte(lower);
  return args.reclaim ? prevOutside && lastInside : !prevOutside && !lastInside;
}

function emptyTiming(): TimingFlags {
  return {
    rejection: false,
    reclaim: false,
    failedRetest: false,
    engulfingImpulse: false,
    rsiReset: false,
    bbMeanReclaim: false,
    bbMeanLoss: false,
  };
}

