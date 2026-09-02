"use client";

import type { CandlesResponse, MarketContextResponse, PriceZoneDto, SignalsResponse } from "@market-sentinel/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
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
  const [note, setNote] = useState("");
  const [lowerBound, setLowerBound] = useState("");
  const [upperBound, setUpperBound] = useState("");
  const [zoneType, setZoneType] = useState<PriceZoneDto["type"]>("SUPPORT");
  const [signals, setSignals] = useState<SignalsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [candlesResponse, contextResponse, signalsResponse] = await Promise.all([
          apiFetch({ path: `/markets/${symbol}/candles?timeframe=${timeframe}` }),
          apiFetch({ path: `/markets/${symbol}/context` }),
          apiFetch({ path: `/signals?instrument=${symbol}` }),
        ]);
        if (!candlesResponse.ok) {
          throw new Error(`API ${candlesResponse.status}`);
        }
        const candlePayload = (await candlesResponse.json()) as CandlesResponse;
        const contextPayload = contextResponse.ok
          ? ((await contextResponse.json()) as MarketContextResponse)
          : null;
        const signalsPayload = signalsResponse.ok ? ((await signalsResponse.json()) as SignalsResponse) : null;
        if (!cancelled) {
          setCandles(candlePayload);
          setContext(contextPayload);
          setSignals(signalsPayload);
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
  const zones = context?.zones ?? [];
  const visibleZones = zones.filter((zone) => zone.timeframe === timeframe || zone.source === "USER_MANUAL");
  const primaryZones = visibleZones.filter((zone) => zone.status === "ACTIVE" || zone.status === "FLIPPED" || zone.source === "USER_MANUAL");
  const brokenZones = visibleZones.filter((zone) => zone.status === "BROKEN" || zone.status === "EXPIRED");
  const mtf = context?.multiTimeframe;
  const activeSignals = (signals?.signals ?? []).filter((signal) => signal.state !== "DISMISSED" && signal.state !== "CLOSED");
  const signalOverlays = activeSignals
    .filter((signal) => signal.state === "WATCHING" || signal.state === "CONFIRMED" || signal.state === "TRADE_PLANNED")
    .map((signal) => ({
      id: signal.id,
      entryLow: signal.entryZoneLow,
      entryHigh: signal.entryZoneHigh,
      invalidation: signal.invalidationPrice,
      target: signal.target1,
    }));

  async function createZone() {
    const response = await apiFetch({
      path: `/markets/${symbol}/zones`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: zoneType, timeframe, lowerBound, upperBound, note }),
      },
    });
    if (response.ok) {
      setLowerBound("");
      setUpperBound("");
      setNote("");
    }
  }

  async function removeZone(args: { id: string }) {
    await apiFetch({ path: `/markets/${symbol}/zones/${args.id}`, init: { method: "DELETE" } });
  }

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
            {quote?.opportunityScore !== null && quote?.opportunityScore !== undefined ? (
              <Badge variant="live">Score {quote.opportunityScore}</Badge>
            ) : null}
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
        <CandleChart candles={candles?.candles ?? []} zones={primaryZones} indicators={indicators} signals={signalOverlays} />
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
          <p className="mt-2 font-mono text-sm">{context?.timeframes["4h"]?.regime?.trend ?? "—"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {mtf?.context4h.extended ? "Extended" : "Not extended"} · {mtf?.context4h.volatility ?? "—"}
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            S {mtf?.context4h.majorSupport ?? "—"} / R {mtf?.context4h.majorResistance ?? "—"}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">1H structure</p>
          <p className="mt-2 font-mono text-sm">{context?.timeframes["1h"]?.regime?.structure ?? "—"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatFlags({ flags: mtf?.setup1h, empty: "No 1H setup flags" })}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">15m timing</p>
          <p className="mt-2 font-mono text-sm">{context?.timeframes["15m"]?.regime?.location ?? "—"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatFlags({ flags: mtf?.timing15m, empty: "No 15m timing flags" })}
          </p>
        </Card>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Distance to key levels</p>
          <p className="mt-2 font-mono text-sm">Support {quote?.closestSupport ?? "—"}</p>
          <p className="mt-1 font-mono text-sm">Resistance {quote?.closestResistance ?? "—"}</p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {panel?.currentCandle
              ? `${panel.currentCandle.isFinal ? "Final" : "Live"} · rev ${panel.currentCandle.revision}`
              : "—"}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Add manual zone</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              className="rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs"
              value={zoneType}
              onChange={(event) => setZoneType(event.target.value as PriceZoneDto["type"])}
            >
              <option value="SUPPORT">Support</option>
              <option value="RESISTANCE">Resistance</option>
              <option value="BOTH">Both</option>
            </select>
            <input
              className="w-24 rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs"
              placeholder="Lower"
              value={lowerBound}
              onChange={(event) => setLowerBound(event.target.value)}
            />
            <input
              className="w-24 rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs"
              placeholder="Upper"
              value={upperBound}
              onChange={(event) => setUpperBound(event.target.value)}
            />
            <input
              className="min-w-[8rem] flex-1 rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs"
              placeholder="Why / note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <button
              type="button"
              className="rounded-sm border border-primary px-3 py-1 font-mono text-xs uppercase text-primary"
              onClick={() => void createZone()}
            >
              Save
            </button>
          </div>
        </Card>
      </section>

      <section className="space-y-2">
        <p className="text-xs uppercase text-muted-foreground">Signal timeline</p>
        {signals?.staleStream ? (
          <Card>
            <p className="text-sm text-muted-foreground">Stream is stale. Signal generation is frozen.</p>
          </Card>
        ) : null}
        {activeSignals.length === 0 ? (
          <Card>
            <p className="text-sm text-muted-foreground">No signals for this market yet.</p>
          </Card>
        ) : (
          activeSignals.map((signal) => {
            const transitions = Array.isArray(signal.evidenceJson.transitions)
              ? (signal.evidenceJson.transitions as Array<{ state?: string; at?: string }>)
              : [];
            return (
              <Card key={signal.id}>
                <p className="font-mono text-sm">
                  {signal.strategyKey} · {signal.direction} · {signal.entryStatus}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  Opportunity score: {signal.score} · {signal.confidenceLabel}
                </p>
                <div className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
                  {transitions.length === 0 ? (
                    <p>
                      {signal.state} at {signal.detectedAt}
                    </p>
                  ) : (
                    transitions.map((item, index) => (
                      <p key={`${signal.id}-${index}`}>
                        {item.state} at {item.at}
                      </p>
                    ))
                  )}
                </div>
              </Card>
            );
          })
        )}
      </section>

      <section className="space-y-2">
        <p className="text-xs uppercase text-muted-foreground">Zones</p>
        {primaryZones.length === 0 ? (
          <Card>
            <p className="text-sm text-muted-foreground">No active zones yet. Auto zones appear after confirmed pivots.</p>
          </Card>
        ) : (
          primaryZones.map((zone) => (
            <Card key={zone.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm">
                    {zone.type} · {zone.source} · {zone.status}
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {zone.lowerBound} – {zone.upperBound} (mid {zone.midpoint}) · {zone.timeframe}
                  </p>
                  <p className="mt-2 text-sm">{explainZone({ zone })}</p>
                </div>
                {zone.source === "USER_MANUAL" ? (
                  <button
                    type="button"
                    className="font-mono text-xs uppercase text-destructive"
                    onClick={() => void removeZone({ id: zone.id })}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </Card>
          ))
        )}
        {brokenZones.length > 0 ? (
          <Card>
            <p className="text-xs uppercase text-muted-foreground">Broken / expired</p>
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {brokenZones
                .slice(0, 8)
                .map((zone) => `${zone.status} ${zone.type} ${zone.midpoint}`)
                .join(" · ")}
              {brokenZones.length > 8 ? ` · +${brokenZones.length - 8} more` : ""}
            </p>
          </Card>
        ) : null}
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

function explainZone(args: { zone: PriceZoneDto }) {
  const why = typeof args.zone.metadataJson.why === "string" ? args.zone.metadataJson.why : "No provenance stored";
  const reaction =
    typeof args.zone.metadataJson.lastReaction === "string" ? args.zone.metadataJson.lastReaction : "no later reaction";
  return `${why}. Touches ${args.zone.touchCount}. Last reaction: ${reaction}.`;
}

function formatFlags(args: { flags: Record<string, boolean> | null | undefined; empty: string }) {
  if (!args.flags) {
    return args.empty;
  }
  const active = Object.entries(args.flags)
    .filter(([, value]) => value)
    .map(([key]) => key);
  return active.length > 0 ? active.join(" · ") : args.empty;
}
