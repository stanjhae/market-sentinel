import { TIMEFRAME_MS, type Timeframe } from "@market-sentinel/domain";
import { candleCloseTimeUtc, candleOpenTimeUtc } from "@market-sentinel/domain/candle";
import { Decimal } from "decimal.js";
import type { InputCandle } from "./types.js";

export function closedBy(args: { candle: InputCandle; asOf: Date }): boolean {
  return args.candle.closeTimeUtc.getTime() <= args.asOf.getTime();
}

export function prefixCandles(args: { candles: InputCandle[]; asOf: Date }): InputCandle[] {
  return args.candles.filter((candle) => candle.isFinal && closedBy({ candle, asOf: args.asOf }));
}

export function higherPrefix(args: {
  provided: InputCandle[] | undefined;
  bars15m: InputCandle[];
  timeframe: Timeframe;
  asOf: Date;
}): InputCandle[] {
  if (args.provided && args.provided.length > 0) {
    return prefixCandles({ candles: args.provided, asOf: args.asOf });
  }
  return aggregateFrom15m({ bars15m: args.bars15m, timeframe: args.timeframe });
}

export function aggregateFrom15m(args: { bars15m: InputCandle[]; timeframe: Timeframe }): InputCandle[] {
  if (args.timeframe === "15m") {
    return args.bars15m.filter((bar) => bar.isFinal);
  }
  const groups = new Map<number, InputCandle[]>();
  for (const bar of args.bars15m) {
    if (!bar.isFinal) {
      continue;
    }
    const open = candleOpenTimeUtc({ at: bar.openTimeUtc, timeframe: args.timeframe });
    const key = open.getTime();
    const existing = groups.get(key) ?? [];
    existing.push(bar);
    groups.set(key, existing);
  }
  const size = TIMEFRAME_MS[args.timeframe];
  const needed = size / TIMEFRAME_MS["15m"];
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([openMs, bars]) => {
      if (bars.length < needed) {
        return [];
      }
      const first = bars[0]!;
      const openTimeUtc = new Date(openMs);
      return [
        {
          instrumentId: first.instrumentId,
          symbol: first.symbol,
          timeframe: args.timeframe,
          openTimeUtc,
          closeTimeUtc: candleCloseTimeUtc({ openTimeUtc, timeframe: args.timeframe }),
          open: bars[0]!.open,
          high: bars.reduce((max, bar) => Decimal.max(max, bar.high), new Decimal(bars[0]!.high)).toString(),
          low: bars.reduce((min, bar) => Decimal.min(min, bar.low), new Decimal(bars[0]!.low)).toString(),
          close: bars[bars.length - 1]!.close,
          isFinal: true,
        },
      ];
    });
}
