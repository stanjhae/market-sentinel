"use client";

import type { CandleDto, IndicatorSnapshotDto, PriceZoneDto } from "@market-sentinel/contracts";
import { useEffect, useRef } from "react";
import { decideChartSync, overlayLines, toChartBars, type OverlayLine } from "./candle-chart-sync";

type CandleChartProps = {
  candles: CandleDto[];
  zones?: PriceZoneDto[];
  indicators?: IndicatorSnapshotDto | null;
};

type PriceLine = { applyOptions: (options: object) => void };
type CandleSeries = {
  setData: (data: Array<{ time: never; open: number; high: number; low: number; close: number }>) => void;
  update: (bar: { time: never; open: number; high: number; low: number; close: number }) => void;
  createPriceLine: (options: object) => PriceLine;
  removePriceLine: (line: PriceLine) => void;
};

type ChartInstance = {
  remove: () => void;
  applyOptions: (options: object) => void;
  timeScale: () => { fitContent: () => void };
};

function cssHsl(args: { name: string }): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(args.name).trim();
  return `hsl(${value})`;
}

export function CandleChart({ candles, zones = [], indicators = null }: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartInstance | null>(null);
  const seriesRef = useRef<CandleSeries | null>(null);
  const overlayRef = useRef<Map<string, PriceLine>>(new Map());
  const candlesRef = useRef(candles);
  const zonesRef = useRef(zones);
  const indicatorsRef = useRef(indicators);
  const firstOpenRef = useRef<string | null>(null);
  const lastOpenRef = useRef<string | null>(null);
  candlesRef.current = candles;
  zonesRef.current = zones;
  indicatorsRef.current = indicators;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;

    void import("lightweight-charts")
      .then(({ ColorType, createChart }) => {
        if (disposed || !containerRef.current) {
          return;
        }
        const instance = createChart(containerRef.current, {
          autoSize: true,
          layout: {
            background: { type: ColorType.Solid, color: cssHsl({ name: "--card" }) },
            textColor: cssHsl({ name: "--muted-foreground" }),
          },
          grid: {
            vertLines: { color: cssHsl({ name: "--border" }) },
            horzLines: { color: cssHsl({ name: "--border" }) },
          },
          rightPriceScale: { borderColor: cssHsl({ name: "--border" }) },
          timeScale: { borderColor: cssHsl({ name: "--border" }), timeVisible: true, secondsVisible: false },
        });
        const series = instance.addCandlestickSeries({
          upColor: cssHsl({ name: "--live" }),
          downColor: cssHsl({ name: "--destructive" }),
          borderUpColor: cssHsl({ name: "--live" }),
          borderDownColor: cssHsl({ name: "--destructive" }),
          wickUpColor: cssHsl({ name: "--live" }),
          wickDownColor: cssHsl({ name: "--destructive" }),
        });
        chartRef.current = instance;
        seriesRef.current = series as unknown as CandleSeries;
        applyCandleUpdate({
          chart: instance,
          series: series as unknown as CandleSeries,
          candles: candlesRef.current,
          previousFirstOpen: firstOpenRef.current,
          previousLastOpen: lastOpenRef.current,
          firstOpenRef,
          lastOpenRef,
        });
        applyOverlays({
          series: series as unknown as CandleSeries,
          overlayRef,
          lines: overlayLines({ zones: zonesRef.current, indicators: indicatorsRef.current }),
        });
        resizeObserver = new ResizeObserver(() => {
          instance.applyOptions({ width: containerRef.current?.clientWidth ?? 0 });
        });
        resizeObserver.observe(containerRef.current);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
      overlayRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) {
      return;
    }
    applyCandleUpdate({
      chart,
      series,
      candles,
      previousFirstOpen: firstOpenRef.current,
      previousLastOpen: lastOpenRef.current,
      firstOpenRef,
      lastOpenRef,
    });
  }, [candles]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) {
      return;
    }
    applyOverlays({
      series,
      overlayRef,
      lines: overlayLines({ zones, indicators }),
    });
  }, [zones, indicators]);

  return <div ref={containerRef} className="h-[420px] w-full" />;
}

function applyCandleUpdate(args: {
  chart: ChartInstance;
  series: CandleSeries;
  candles: CandleDto[];
  previousFirstOpen: string | null;
  previousLastOpen: string | null;
  firstOpenRef: { current: string | null };
  lastOpenRef: { current: string | null };
}): void {
  const firstOpen = args.candles[0]?.openTimeUtc ?? null;
  const lastOpen = args.candles[args.candles.length - 1]?.openTimeUtc ?? null;
  const decision = decideChartSync({
    firstOpen,
    lastOpen,
    previousFirstOpen: args.previousFirstOpen,
    previousLastOpen: args.previousLastOpen,
  });
  const bars = toChartBars({ candles: args.candles }).map((bar) => ({
    ...bar,
    time: bar.time as never,
  }));
  if (decision.mode === "clear") {
    args.series.setData([]);
  } else if (decision.mode === "setData") {
    args.series.setData(bars);
  } else {
    const lastBar = bars[bars.length - 1];
    if (lastBar) {
      args.series.update(lastBar);
    }
  }
  if (decision.fitContent) {
    args.chart.timeScale().fitContent();
  }
  args.firstOpenRef.current = firstOpen;
  args.lastOpenRef.current = lastOpen;
}

function applyOverlays(args: {
  series: CandleSeries;
  overlayRef: { current: Map<string, PriceLine> };
  lines: OverlayLine[];
}): void {
  const nextIds = new Set(args.lines.map((line) => line.id));
  for (const [id, line] of args.overlayRef.current) {
    if (!nextIds.has(id)) {
      args.series.removePriceLine(line);
      args.overlayRef.current.delete(id);
    }
  }
  for (const line of args.lines) {
    const options = {
      price: line.price,
      color: overlayColor({ tone: line.tone }),
      lineWidth: line.tone === "broken" ? 1 : 2,
      lineStyle: line.tone === "broken" || line.tone === "ema" || line.tone === "bb" ? 2 : 0,
      axisLabelVisible: true,
      title: line.title,
    };
    const existing = args.overlayRef.current.get(line.id);
    if (existing) {
      existing.applyOptions(options);
    } else {
      args.overlayRef.current.set(line.id, args.series.createPriceLine(options));
    }
  }
}

function overlayColor(args: { tone: OverlayLine["tone"] }): string {
  if (args.tone === "support") {
    return cssHsl({ name: "--live" });
  }
  if (args.tone === "resistance") {
    return cssHsl({ name: "--destructive" });
  }
  if (args.tone === "broken") {
    return cssHsl({ name: "--muted-foreground" });
  }
  if (args.tone === "ema") {
    return cssHsl({ name: "--primary" });
  }
  if (args.tone === "bb") {
    return cssHsl({ name: "--stale" });
  }
  return cssHsl({ name: "--foreground" });
}
