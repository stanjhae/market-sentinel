"use client";

import type { CandlesResponse, MarketContextResponse } from "@market-sentinel/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { API_BASE_URL } from "@/lib/api";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";

const CandleChart = dynamic(
  () => import("@/components/candle-chart").then((mod) => ({ default: mod.CandleChart })),
  { ssr: false },
);

type Timeframe = "15m" | "1h" | "4h";

type MarketDetailProps = {
  symbol: string;
  timeframes: readonly Timeframe[];
};

function freshnessVariant(value: string) {
  if (value === "LIVE") return "live" as const;
  if (value === "STALE" || value === "DELAYED") return "stale" as const;
  return "disconnected" as const;
}

export function MarketDetail({ symbol, timeframes }: MarketDetailProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [candles, setCandles] = useState<CandlesResponse | null>(null);
  const [context, setContext] = useState<MarketContextResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [candlesResponse, contextResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/markets/${symbol}/candles?timeframe=${timeframe}`),
          fetch(`${API_BASE_URL}/markets/${symbol}/context`),
        ]);
        if (!candlesResponse.ok) {
          throw new Error(`API ${candlesResponse.status}`);
        }
        const candlePayload = (await candlesResponse.json()) as CandlesResponse;
        const contextPayload = contextResponse.ok
          ? ((await contextResponse.json()) as MarketContextResponse)
          : null;
        if (!cancelled) {
          setCandles(candlePayload);
          setContext(contextPayload);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "API unavailable");
        }
      }
    }

    void load();
    const timer = setInterval(() => {
      void load();
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [symbol, timeframe]);

  const quote = context?.quote;
  const panel = context?.timeframes[timeframe];
  const indicators = panel?.indicators;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/" className="font-mono text-xs uppercase text-muted-foreground">
            Watchlist
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{quote?.displayName ?? symbol}</h1>
          <p className="font-mono text-sm text-muted-foreground">{symbol}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-semibold tabular-nums">{quote?.last ?? quote?.bid ?? "—"}</p>
          <div className="mt-2 flex justify-end gap-2">
            <Badge variant={freshnessVariant(quote?.freshness ?? "DISCONNECTED")}>
              {quote?.freshness ?? "DISCONNECTED"}
            </Badge>
            <Badge>{error ?? (candles?.available ? "Candles" : "No history")}</Badge>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        {timeframes.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTimeframe(item)}
            className={cn("rounded-sm border px-3 py-1 font-mono text-xs uppercase", {
              "border-primary bg-primary/10 text-primary": timeframe === item,
              "border-border text-muted-foreground": timeframe !== item,
            })}
          >
            {item}
          </button>
        ))}
      </div>

      <Card className="p-2">
        <CandleChart candles={candles?.candles ?? []} />
      </Card>

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="RSI 14" value={indicators?.rsi14} />
        <MetricCard label="ATR 14" value={indicators?.atr14} />
        <MetricCard label="EMA 20" value={indicators?.ema20} />
        <MetricCard label="EMA 50" value={indicators?.ema50} />
        <MetricCard label="EMA 200" value={indicators?.ema200} />
        <MetricCard label="BB basis" value={indicators?.bbBasis20} />
        <MetricCard label="BB upper" value={indicators?.bbUpper20x2} />
        <MetricCard label="BB lower" value={indicators?.bbLower20x2} />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Card>
          <p className="text-xs uppercase text-muted-foreground">4H regime</p>
          <p className="mt-2 text-sm">Available in Milestone 3</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">1H structure</p>
          <p className="mt-2 text-sm">Available in Milestone 3</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Current candle</p>
          <p className="mt-2 font-mono text-sm">
            {panel?.currentCandle
              ? `${panel.currentCandle.isFinal ? "Final" : "Live"} · rev ${panel.currentCandle.revision}`
              : "—"}
          </p>
        </Card>
      </section>
    </div>
  );
}

function MetricCard(args: { label: string; value: string | null | undefined }) {
  return (
    <Card>
      <p className="text-xs uppercase text-muted-foreground">{args.label}</p>
      <p className="mt-2 font-mono text-sm tabular-nums">{formatMetric({ value: args.value })}</p>
    </Card>
  );
}

function formatMetric(args: { value: string | null | undefined }) {
  if (!args.value) {
    return "—";
  }
  const numeric = Number(args.value);
  if (Number.isNaN(numeric)) {
    return args.value;
  }
  return numeric.toFixed(numeric >= 100 ? 2 : 4);
}
