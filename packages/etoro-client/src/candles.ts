import { decimalString } from "./format.js";
import type { EtoroCandlesResponse, NormalizedHistoryCandle } from "./types.js";

export function flattenHistoryCandles(args: {
  data: EtoroCandlesResponse;
  fallbackInstrumentId: number;
}): NormalizedHistoryCandle[] {
  const groups = args.data.candles ?? [];
  const raw = groups.flatMap((group) => group.candles ?? []);
  const mapped = raw.flatMap((candle) => {
    const fromDate = candle.fromDate;
    const open = decimalString(candle.open);
    const high = decimalString(candle.high);
    const low = decimalString(candle.low);
    const close = decimalString(candle.close);
    if (!fromDate || !open || !high || !low || !close) {
      return [];
    }
    return [
      {
        etoroInstrumentId: candle.instrumentID ?? args.fallbackInstrumentId,
        fromDate,
        open,
        high,
        low,
        close,
        volume: decimalString(candle.volume),
      },
    ];
  });
  return mapped.sort((left, right) => Date.parse(left.fromDate) - Date.parse(right.fromDate));
}
