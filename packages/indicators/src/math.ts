import { Decimal } from "decimal.js";

export type OhlcBar = {
  open: string;
  high: string;
  low: string;
  close: string;
};

export type IndicatorValues = {
  rsi14: string | null;
  atr14: string | null;
  ema20: string | null;
  ema50: string | null;
  ema200: string | null;
  bbBasis20: string | null;
  bbUpper20x2: string | null;
  bbLower20x2: string | null;
  bbWidth: string | null;
  trueRange: string | null;
  rollingVolatility: string | null;
  rollingHigh: string | null;
  rollingLow: string | null;
  bodySize: string | null;
  upperWick: string | null;
  lowerWick: string | null;
  upperWickRatio: string | null;
  lowerWickRatio: string | null;
  distanceFromEma20InAtr: string | null;
  distanceFromEma50InAtr: string | null;
};

function dec(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

function lastOf(values: Array<Decimal | null>): string | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value) {
      return value.toString();
    }
  }
  return null;
}

export function trueRange(args: { bar: OhlcBar; previousClose: string | null }): Decimal {
  const high = dec(args.bar.high);
  const low = dec(args.bar.low);
  const range = high.minus(low);
  if (args.previousClose === null) {
    return range;
  }
  const previous = dec(args.previousClose);
  return Decimal.max(range, high.minus(previous).abs(), low.minus(previous).abs());
}

export function emaSeries(args: { values: string[]; period: number }): Array<Decimal | null> {
  const { period } = args;
  const result: Array<Decimal | null> = args.values.map(() => null);
  if (args.values.length < period) {
    return result;
  }
  let sum = new Decimal(0);
  for (let index = 0; index < period; index += 1) {
    sum = sum.plus(args.values[index] ?? 0);
  }
  let current = sum.div(period);
  result[period - 1] = current;
  const k = new Decimal(2).div(period + 1);
  const oneMinusK = new Decimal(1).minus(k);
  for (let index = period; index < args.values.length; index += 1) {
    current = k.times(args.values[index] ?? 0).plus(oneMinusK.times(current));
    result[index] = current;
  }
  return result;
}

export function rsiWilderSeries(args: { closes: string[]; period?: number }): Array<Decimal | null> {
  const period = args.period ?? 14;
  const result: Array<Decimal | null> = args.closes.map(() => null);
  if (args.closes.length < period + 1) {
    return result;
  }

  let gainSum = new Decimal(0);
  let lossSum = new Decimal(0);
  for (let index = 1; index <= period; index += 1) {
    const change = dec(args.closes[index] ?? 0).minus(args.closes[index - 1] ?? 0);
    if (change.gt(0)) {
      gainSum = gainSum.plus(change);
    } else {
      lossSum = lossSum.plus(change.abs());
    }
  }

  let avgGain = gainSum.div(period);
  let avgLoss = lossSum.div(period);
  result[period] = rsiFromAverages({ avgGain, avgLoss });

  for (let index = period + 1; index < args.closes.length; index += 1) {
    const change = dec(args.closes[index] ?? 0).minus(args.closes[index - 1] ?? 0);
    const gain = change.gt(0) ? change : new Decimal(0);
    const loss = change.lt(0) ? change.abs() : new Decimal(0);
    avgGain = avgGain.times(period - 1).plus(gain).div(period);
    avgLoss = avgLoss.times(period - 1).plus(loss).div(period);
    result[index] = rsiFromAverages({ avgGain, avgLoss });
  }
  return result;
}

function rsiFromAverages(args: { avgGain: Decimal; avgLoss: Decimal }): Decimal {
  if (args.avgGain.eq(0) && args.avgLoss.eq(0)) {
    return new Decimal(50);
  }
  if (args.avgLoss.eq(0)) {
    return new Decimal(100);
  }
  if (args.avgGain.eq(0)) {
    return new Decimal(0);
  }
  const rs = args.avgGain.div(args.avgLoss);
  return new Decimal(100).minus(new Decimal(100).div(rs.plus(1)));
}

export function atrWilderSeries(args: { bars: OhlcBar[]; period?: number }): Array<Decimal | null> {
  const period = args.period ?? 14;
  const result: Array<Decimal | null> = args.bars.map(() => null);
  if (args.bars.length < period + 1) {
    return result;
  }

  const ranges: Decimal[] = [];
  for (let index = 0; index < args.bars.length; index += 1) {
    const bar = args.bars[index];
    if (!bar) {
      continue;
    }
    const previous = index === 0 ? null : (args.bars[index - 1]?.close ?? null);
    ranges.push(trueRange({ bar, previousClose: previous }));
  }

  let atr = ranges.slice(1, period + 1).reduce((sum, value) => sum.plus(value), new Decimal(0)).div(period);
  result[period] = atr;
  for (let index = period + 1; index < ranges.length; index += 1) {
    atr = atr.times(period - 1).plus(ranges[index] ?? 0).div(period);
    result[index] = atr;
  }
  return result;
}

export function bollinger(args: { closes: string[]; period?: number; multiplier?: number }): {
  basis: Decimal | null;
  upper: Decimal | null;
  lower: Decimal | null;
  width: Decimal | null;
  stdev: Decimal | null;
} {
  const period = args.period ?? 20;
  const multiplier = args.multiplier ?? 2;
  if (args.closes.length < period) {
    return { basis: null, upper: null, lower: null, width: null, stdev: null };
  }
  const window = args.closes.slice(-period).map((value) => dec(value));
  const basis = window.reduce((sum, value) => sum.plus(value), new Decimal(0)).div(period);
  const variance = window
    .reduce((sum, value) => sum.plus(value.minus(basis).pow(2)), new Decimal(0))
    .div(period);
  const stdev = variance.sqrt();
  const upper = basis.plus(stdev.times(multiplier));
  const lower = basis.minus(stdev.times(multiplier));
  const width = basis.eq(0) ? null : upper.minus(lower).div(basis);
  return { basis, upper, lower, width, stdev };
}

export function candleGeometry(args: { bar: OhlcBar }): {
  bodySize: Decimal;
  upperWick: Decimal;
  lowerWick: Decimal;
  upperWickRatio: Decimal | null;
  lowerWickRatio: Decimal | null;
} {
  const open = dec(args.bar.open);
  const close = dec(args.bar.close);
  const high = dec(args.bar.high);
  const low = dec(args.bar.low);
  const bodySize = close.minus(open).abs();
  const upperWick = high.minus(Decimal.max(open, close));
  const lowerWick = Decimal.min(open, close).minus(low);
  const range = high.minus(low);
  return {
    bodySize,
    upperWick,
    lowerWick,
    upperWickRatio: range.eq(0) ? null : upperWick.div(range),
    lowerWickRatio: range.eq(0) ? null : lowerWick.div(range),
  };
}

export function distanceInAtr(args: { price: string; reference: string | null; atr: string | null }): string | null {
  if (!args.reference || !args.atr || dec(args.atr).eq(0)) {
    return null;
  }
  return dec(args.price).minus(args.reference).div(args.atr).toString();
}

export function distanceFromZoneInAtr(args: {
  price: string;
  lowerBound: string;
  upperBound: string;
  atr: string | null;
}): string | null {
  if (!args.atr || dec(args.atr).eq(0)) {
    return null;
  }
  const price = dec(args.price);
  const lower = dec(args.lowerBound);
  const upper = dec(args.upperBound);
  if (price.gte(lower) && price.lte(upper)) {
    return "0";
  }
  const nearest = price.lt(lower) ? lower : upper;
  return price.minus(nearest).abs().div(args.atr).toString();
}

export function computeIndicatorSnapshot(args: { bars: OhlcBar[] }): IndicatorValues {
  const last = args.bars[args.bars.length - 1];
  if (!last) {
    return emptyIndicators();
  }
  const closes = args.bars.map((bar) => bar.close);
  const highs = args.bars.map((bar) => bar.high);
  const lows = args.bars.map((bar) => bar.low);
  const rsi = lastOf(rsiWilderSeries({ closes, period: 14 }));
  const atr = lastOf(atrWilderSeries({ bars: args.bars, period: 14 }));
  const ema20 = lastOf(emaSeries({ values: closes, period: 20 }));
  const ema50 = lastOf(emaSeries({ values: closes, period: 50 }));
  const ema200 = lastOf(emaSeries({ values: closes, period: 200 }));
  const bands = bollinger({ closes, period: 20, multiplier: 2 });
  const geometry = candleGeometry({ bar: last });
  const previous = args.bars.length > 1 ? (args.bars[args.bars.length - 2]?.close ?? null) : null;
  const rollingWindow = 20;
  const recentHighs = highs.slice(-rollingWindow);
  const recentLows = lows.slice(-rollingWindow);

  return {
    rsi14: rsi,
    atr14: atr,
    ema20,
    ema50,
    ema200,
    bbBasis20: bands.basis?.toString() ?? null,
    bbUpper20x2: bands.upper?.toString() ?? null,
    bbLower20x2: bands.lower?.toString() ?? null,
    bbWidth: bands.width?.toString() ?? null,
    trueRange: trueRange({ bar: last, previousClose: previous }).toString(),
    rollingVolatility: bands.stdev?.toString() ?? null,
    rollingHigh: recentHighs.length ? Decimal.max(...recentHighs).toString() : null,
    rollingLow: recentLows.length ? Decimal.min(...recentLows).toString() : null,
    bodySize: geometry.bodySize.toString(),
    upperWick: geometry.upperWick.toString(),
    lowerWick: geometry.lowerWick.toString(),
    upperWickRatio: geometry.upperWickRatio?.toString() ?? null,
    lowerWickRatio: geometry.lowerWickRatio?.toString() ?? null,
    distanceFromEma20InAtr: distanceInAtr({ price: last.close, reference: ema20, atr }),
    distanceFromEma50InAtr: distanceInAtr({ price: last.close, reference: ema50, atr }),
  };
}

function emptyIndicators(): IndicatorValues {
  return {
    rsi14: null,
    atr14: null,
    ema20: null,
    ema50: null,
    ema200: null,
    bbBasis20: null,
    bbUpper20x2: null,
    bbLower20x2: null,
    bbWidth: null,
    trueRange: null,
    rollingVolatility: null,
    rollingHigh: null,
    rollingLow: null,
    bodySize: null,
    upperWick: null,
    lowerWick: null,
    upperWickRatio: null,
    lowerWickRatio: null,
    distanceFromEma20InAtr: null,
    distanceFromEma50InAtr: null,
  };
}
