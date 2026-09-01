import type { CandleDto, IndicatorSnapshotDto, PriceZoneDto } from "@market-sentinel/contracts";

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

export type OverlayLine = {
  id: string;
  price: number;
  title: string;
  tone: "support" | "resistance" | "both" | "broken" | "ema" | "bb" | "signal";
};

export type SignalOverlay = {
  id: string;
  entryLow?: string | null;
  entryHigh?: string | null;
  invalidation?: string | null;
  target?: string | null;
};

export function overlayLines(args: {
  zones: PriceZoneDto[];
  indicators: IndicatorSnapshotDto | null;
  signals?: SignalOverlay[];
}): OverlayLine[] {
  const lines: OverlayLine[] = args.zones.flatMap((zone) => {
    const tone =
      zone.status !== "ACTIVE" ? "broken" : zone.type === "SUPPORT" ? "support" : zone.type === "RESISTANCE" ? "resistance" : "both";
    return [
      {
        id: `${zone.id}:mid`,
        price: Number(zone.midpoint),
        title: `${zone.type} ${zone.source}`,
        tone,
      },
    ];
  });
  const indicators = args.indicators;
  if (indicators?.ema20) {
    lines.push({ id: "ema20", price: Number(indicators.ema20), title: "EMA 20", tone: "ema" });
  }
  if (indicators?.ema50) {
    lines.push({ id: "ema50", price: Number(indicators.ema50), title: "EMA 50", tone: "ema" });
  }
  if (indicators?.bbUpper20x2) {
    lines.push({ id: "bbUpper", price: Number(indicators.bbUpper20x2), title: "BB upper", tone: "bb" });
  }
  if (indicators?.bbBasis20) {
    lines.push({ id: "bbBasis", price: Number(indicators.bbBasis20), title: "BB basis", tone: "bb" });
  }
  if (indicators?.bbLower20x2) {
    lines.push({ id: "bbLower", price: Number(indicators.bbLower20x2), title: "BB lower", tone: "bb" });
  }
  for (const signal of args.signals ?? []) {
    if (signal.entryLow) {
      lines.push({ id: `${signal.id}:entryLow`, price: Number(signal.entryLow), title: "Entry low", tone: "signal" });
    }
    if (signal.entryHigh) {
      lines.push({ id: `${signal.id}:entryHigh`, price: Number(signal.entryHigh), title: "Entry high", tone: "signal" });
    }
    if (signal.invalidation) {
      lines.push({ id: `${signal.id}:inv`, price: Number(signal.invalidation), title: "Invalidation", tone: "signal" });
    }
    if (signal.target) {
      lines.push({ id: `${signal.id}:t1`, price: Number(signal.target), title: "Target 1", tone: "signal" });
    }
  }
  return lines;
}
