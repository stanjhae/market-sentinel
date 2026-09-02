import { BACKTEST_DEFAULTS, TIMEFRAME_MS, TIMEFRAMES, type StructureLabel, type Timeframe } from "@market-sentinel/domain";
import { atrWilderSeries, computeIndicatorSnapshot, type IndicatorValues } from "@market-sentinel/indicators";
import {
  applyZoneBreaks,
  buildMultiTimeframeContext,
  classifyRegime,
  classifySwings,
  clusterAutoZones,
  detectConfirmedPivots,
  expireIdleZones,
  mergeAutoZones,
  mergePriorZones,
  priorPeriodZones,
  reactionAfterTouch,
  scoreZoneStrength,
  zonesOverlap,
  type MarketRegime,
  type PriceZone,
  type StructureBar,
} from "@market-sentinel/market-structure";
import type { StrategyIndicators, StrategySnapshot } from "@market-sentinel/strategies";
import { randomUUID } from "node:crypto";
import { higherPrefix } from "./aggregate.js";
import type { InputCandle } from "./types.js";

function toStructureBar(args: { candle: InputCandle }): StructureBar {
  return {
    instrumentId: args.candle.instrumentId,
    timeframe: args.candle.timeframe,
    openTimeUtc: args.candle.openTimeUtc,
    high: args.candle.high,
    low: args.candle.low,
    open: args.candle.open,
    close: args.candle.close,
    isFinal: args.candle.isFinal,
  };
}

function lookback(args: { candles: InputCandle[]; limit: number }): InputCandle[] {
  return args.candles.slice(-args.limit);
}

export function structureForTimeframe(args: {
  bars: InputCandle[];
  existing: PriceZone[];
  now: Date;
}): { zones: PriceZone[]; regime: MarketRegime | null } {
  const bars = lookback({ candles: args.bars, limit: BACKTEST_DEFAULTS.structureLookback }).map((candle) =>
    toStructureBar({ candle }),
  );
  if (bars.length === 0) {
    return { zones: args.existing, regime: null };
  }
  const last = bars[bars.length - 1]!;
  const confirmed = detectConfirmedPivots({ candles: bars });
  const atrValues = atrWilderSeries({
    bars: bars.map((bar) => ({ open: bar.open, high: bar.high, low: bar.low, close: bar.close })),
  });
  const atr = atrValues[atrValues.length - 1]?.toString() ?? null;
  const manuals = args.existing.filter((zone) => zone.source === "USER_MANUAL");
  const autoIncoming = clusterAutoZones({
    pivots: confirmed,
    atr,
    existingManual: manuals,
    instrumentId: last.instrumentId,
    timeframe: last.timeframe,
  }).map((zone) => ({ ...zone, id: zone.id ?? randomUUID() }));
  const priorIncoming = priorPeriodZones({
    candles: bars,
    instrumentId: last.instrumentId,
    timeframe: last.timeframe,
    now: args.now,
  }).map((zone) => ({ ...zone, id: zone.id ?? randomUUID() }));
  const thisTf = args.existing.filter((zone) => zone.timeframe === last.timeframe);
  const otherTf = args.existing.filter((zone) => zone.timeframe !== last.timeframe);
  const merged = expireIdleZones({
    zones: applyZoneBreaks({
      zones: [
        ...mergeAutoZones({
          existing: thisTf.filter((zone) => zone.source === "AUTO_PIVOT" || zone.source === "USER_MANUAL"),
          incoming: autoIncoming,
        }),
        ...mergePriorZones({
          existing: thisTf.filter((zone) => zone.source === "PRIOR_DAY" || zone.source === "PRIOR_WEEK"),
          incoming: priorIncoming,
        }),
      ],
      candles: bars,
      atr,
    }),
    lastOpenTime: last.openTimeUtc,
    barMs: TIMEFRAME_MS[last.timeframe],
  }).map((zone) => ({
    ...zone,
    id: zone.id ?? randomUUID(),
    strengthScore: scoreZoneStrength({
      zone,
      multiTimeframe: otherTf.some((other) => other.status === "ACTIVE" && zonesOverlap({ left: zone, right: other })),
      lastBarOpen: last.openTimeUtc,
      barMs: TIMEFRAME_MS[last.timeframe],
      reactionAtr: reactionAfterTouch({ zone, candles: bars, atr }),
    }),
  }));
  const swings = classifySwings({ pivots: confirmed, atr });
  const regime = classifyRegime({
    instrumentId: last.instrumentId,
    timeframe: last.timeframe,
    timestamp: last.openTimeUtc,
    swings,
    atrSeries: atrValues.map((value) => value?.toString() ?? null),
    close: last.close,
    zones: [...otherTf, ...merged],
  });
  return { zones: [...otherTf, ...merged], regime };
}

function indicatorsOf(args: { candles: InputCandle[] }): IndicatorValues | null {
  const bars = lookback({ candles: args.candles, limit: BACKTEST_DEFAULTS.indicatorLookback });
  if (bars.length === 0) {
    return null;
  }
  return computeIndicatorSnapshot({
    bars: bars.map((bar) => ({ open: bar.open, high: bar.high, low: bar.low, close: bar.close })),
  });
}

function toStrategyIndicators(args: { values: IndicatorValues | null; previousRsi: string | null }): StrategyIndicators | undefined {
  if (!args.values) {
    return undefined;
  }
  return {
    rsi14: args.values.rsi14,
    previousRsi14: args.previousRsi,
    atr14: args.values.atr14,
    ema20: args.values.ema20,
    ema50: args.values.ema50,
    bbBasis20: args.values.bbBasis20,
    bbUpper20x2: args.values.bbUpper20x2,
    bbLower20x2: args.values.bbLower20x2,
    trueRange: args.values.trueRange,
  };
}

export type HigherTfCache = Partial<
  Record<
    Exclude<Timeframe, "15m">,
    {
      closeKey: number;
      zones: PriceZone[];
      regime: MarketRegime | null;
      values: IndicatorValues | null;
    }
  >
>;

export function buildSnapshotFromPrefix(args: {
  bars15m: InputCandle[];
  higher?: Partial<Record<Timeframe, InputCandle[]>>;
  previousRsi14?: string | null;
  previousStructure1h?: StructureLabel | null;
  higherCache?: HigherTfCache;
}): { snapshot: StrategySnapshot; indicatorValues: Partial<Record<Timeframe, IndicatorValues>> } | null {
  const finals = args.bars15m.filter((bar) => bar.isFinal);
  const last = finals[finals.length - 1];
  if (!last) {
    return null;
  }
  const asOf = last.closeTimeUtc;
  const byTf: Record<Timeframe, InputCandle[]> = {
    "15m": finals,
    "1h": higherPrefix({ provided: args.higher?.["1h"], bars15m: finals, timeframe: "1h", asOf }),
    "4h": higherPrefix({ provided: args.higher?.["4h"], bars15m: finals, timeframe: "4h", asOf }),
  };
  let zones: PriceZone[] = [];
  const regimes: Partial<Record<Timeframe, MarketRegime | null>> = {};
  const indicators: Partial<Record<Timeframe, StrategyIndicators>> = {};
  const indicatorValues: Partial<Record<Timeframe, IndicatorValues>> = {};
  const lastBars: StrategySnapshot["lastBars"] = {};
  let indicators15m: IndicatorValues | null = null;
  for (const timeframe of TIMEFRAMES) {
    const closeKey = byTf[timeframe][byTf[timeframe].length - 1]?.closeTimeUtc.getTime() ?? 0;
    const cached = timeframe === "15m" ? undefined : args.higherCache?.[timeframe];
    if (cached && cached.closeKey === closeKey) {
      const thisTf = cached.zones.filter((zone) => zone.timeframe === timeframe);
      const otherTf = zones.filter((zone) => zone.timeframe !== timeframe);
      zones = [...otherTf, ...thisTf];
      regimes[timeframe] = cached.regime;
      if (cached.values) {
        indicatorValues[timeframe] = cached.values;
      }
      indicators[timeframe] = toStrategyIndicators({
        values: cached.values,
        previousRsi: null,
      });
      lastBars[timeframe] = lookback({ candles: byTf[timeframe], limit: 8 }).map((candle) => toStructureBar({ candle }));
      continue;
    }
    const structured = structureForTimeframe({
      bars: byTf[timeframe],
      existing: zones,
      now: last.openTimeUtc,
    });
    zones = structured.zones;
    regimes[timeframe] = structured.regime;
    const values = indicatorsOf({ candles: byTf[timeframe] });
    if (values) {
      indicatorValues[timeframe] = values;
    }
    if (timeframe === "15m") {
      indicators15m = values;
    }
    indicators[timeframe] = toStrategyIndicators({
      values,
      previousRsi: timeframe === "15m" ? (args.previousRsi14 ?? null) : null,
    });
    lastBars[timeframe] = lookback({ candles: byTf[timeframe], limit: 8 }).map((candle) => toStructureBar({ candle }));
    if (timeframe !== "15m" && args.higherCache) {
      args.higherCache[timeframe] = {
        closeKey,
        zones: structured.zones.filter((zone) => zone.timeframe === timeframe),
        regime: structured.regime,
        values,
      };
    }
  }
  const last1h = byTf["1h"][byTf["1h"].length - 1] ?? null;
  return {
    snapshot: {
      instrumentId: last.instrumentId,
      evaluatedAt: last.openTimeUtc,
      lastFinalClose: last.close,
      lastFinalOpenTimeUtc: last.openTimeUtc,
      triggerTimeframe: "15m",
      streamFreshness: "LIVE",
      multiTimeframe: buildMultiTimeframeContext({
        regimes,
        zones,
        bars15m: lookback({ candles: byTf["15m"], limit: 8 }).map((candle) => toStructureBar({ candle })),
        indicators15m: {
          rsi14: indicators15m?.rsi14 ?? null,
          previousRsi14: args.previousRsi14 ?? null,
          atr14: indicators15m?.atr14 ?? null,
          bbBasis20: indicators15m?.bbBasis20 ?? null,
          bbUpper20x2: indicators15m?.bbUpper20x2 ?? null,
          bbLower20x2: indicators15m?.bbLower20x2 ?? null,
        },
        close1h: last1h?.close ?? last.close,
        atr1h: indicators["1h"]?.atr14 ?? null,
        previousStructure1h: args.previousStructure1h ?? null,
      }),
      regimes,
      zones,
      indicators,
      lastBars,
    },
    indicatorValues,
  };
}
