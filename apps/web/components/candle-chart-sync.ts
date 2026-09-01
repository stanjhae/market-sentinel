import type { CandleDto } from "@market-sentinel/contracts";

export type ChartBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export function toChartBars(args: { candles: CandleDto[] }): ChartBar[] {
  return args.candles.map((candle) => ({
    time: Math.floor(Date.parse(candle.openTimeUtc) / 1000),
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
  }));
}

export function decideChartSync(args: {
  firstOpen: string | null;
  lastOpen: string | null;
  previousFirstOpen: string | null;
  previousLastOpen: string | null;
}): { mode: "clear" | "setData" | "updateLast"; fitContent: boolean } {
  if (!args.firstOpen || !args.lastOpen) {
    return { mode: "clear", fitContent: false };
  }
  if (args.previousFirstOpen === null || args.previousLastOpen === null) {
    return { mode: "setData", fitContent: true };
  }
  if (args.firstOpen !== args.previousFirstOpen) {
    return { mode: "setData", fitContent: true };
  }
  return { mode: "updateLast", fitContent: false };
}
