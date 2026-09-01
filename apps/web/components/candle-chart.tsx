"use client";

import type { CandleDto } from "@market-sentinel/contracts";
import { useEffect, useRef } from "react";
import { decideChartSync, toChartBars } from "./candle-chart-sync";

type CandleChartProps = {
  candles: CandleDto[];
};

type CandleSeries = {
  setData: (data: Array<{ time: never; open: number; high: number; low: number; close: number }>) => void;
  update: (bar: { time: never; open: number; high: number; low: number; close: number }) => void;
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

export function CandleChart({ candles }: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartInstance | null>(null);
  const seriesRef = useRef<CandleSeries | null>(null);
  const candlesRef = useRef(candles);
  const firstOpenRef = useRef<string | null>(null);
  const lastOpenRef = useRef<string | null>(null);
  candlesRef.current = candles;

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
