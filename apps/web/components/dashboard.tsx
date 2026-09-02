"use client";

import type { AccountResponse, MarketsResponse, RiskStatus, SseEvent } from "@market-sentinel/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { API_BASE_URL } from "@/lib/api";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSentinelEvents } from "./sentinel-stream";

type DashboardProps = {
  symbols: string[];
};

function freshnessVariant(value: string) {
  if (value === "LIVE") return "live" as const;
  if (value === "STALE" || value === "DELAYED") return "stale" as const;
  return "disconnected" as const;
}

export function Dashboard({ symbols }: DashboardProps) {
  const [markets, setMarkets] = useState<MarketsResponse | null>(null);
  const [account, setAccount] = useState<AccountResponse | null>(null);
  const [risk, setRisk] = useState<RiskStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRest() {
      try {
        const [marketsResponse, accountResponse, riskResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/markets`),
          fetch(`${API_BASE_URL}/account`),
          fetch(`${API_BASE_URL}/risk/status`),
        ]);
        if (!marketsResponse.ok) {
          throw new Error(`API ${marketsResponse.status}`);
        }
        const payload = (await marketsResponse.json()) as MarketsResponse;
        const accountPayload = accountResponse.ok
          ? ((await accountResponse.json()) as AccountResponse)
          : null;
        const riskPayload = riskResponse.ok ? ((await riskResponse.json()) as RiskStatus) : null;
        if (!cancelled) {
          setMarkets(payload);
          setAccount(accountPayload);
          setRisk(riskPayload);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "API unavailable");
        }
      }
    }

    void loadRest();

    return () => {
      cancelled = true;
    };
  }, []);

  const onStreamEvent = useCallback((event: SseEvent) => {
    if (event.type === "markets") {
      setMarkets(event.payload);
      setError(null);
    }
    if (event.type === "account" || event.type === "risk") {
      void Promise.all([fetch(`${API_BASE_URL}/account`), fetch(`${API_BASE_URL}/risk/status`)])
        .then(async ([accountResponse, riskResponse]) => {
          if (accountResponse.ok) setAccount((await accountResponse.json()) as AccountResponse);
          if (riskResponse.ok) setRisk((await riskResponse.json()) as RiskStatus);
        })
        .catch(() => undefined);
    }
    if (event.type === "signal") {
      void fetch(`${API_BASE_URL}/markets`)
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: MarketsResponse | null) => {
          if (payload) {
            setMarkets(payload);
          }
        })
        .catch(() => undefined);
    }
  }, []);
  useSentinelEvents({ onEvent: onStreamEvent });

  const status = markets?.streamStatus ?? "DISCONNECTED";

  return (
    <div className="space-y-6">
      {risk && risk.tradingStatus !== "ACTIVE" ? (
        <Card>
          <Badge variant="stale">{risk.newsBlackout ? "NEWS BLACKOUT ACTIVE" : risk.tradingStatus.replaceAll("_", " ")}</Badge>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Today P/L {risk.dailyPnl ?? "—"} · Remaining {risk.riskRemainingUsd ?? "—"} · Losses {risk.consecutiveLosses}
          </p>
        </Card>
      ) : null}
      <section className="grid gap-3 md:grid-cols-5">
        <Card>
          <p className="text-xs uppercase text-muted-foreground">eToro</p>
          <p className="mt-2 font-mono text-sm">{markets?.etoroConnected ? "Connected" : "Disconnected"}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Stream</p>
          <div className="mt-2">
            <Badge variant={freshnessVariant(status)}>{status}</Badge>
          </div>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Last quote</p>
          <p className="mt-2 font-mono text-sm">{markets?.lastQuoteAt ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Equity</p>
          <p className="mt-2 font-mono text-sm">{account?.equity ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">API</p>
          <p className="mt-2 font-mono text-sm">{error ?? "Live"}</p>
        </Card>
      </section>
      <section className="grid gap-3 md:grid-cols-4">
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Trading status</p>
          <p className="mt-2 font-mono text-sm">{risk?.tradingStatus ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Today P/L</p>
          <p className="mt-2 font-mono text-sm">{risk?.dailyPnl ?? account?.realizedDailyPnl ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Risk remaining</p>
          <p className="mt-2 font-mono text-sm">{risk?.riskRemainingUsd ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Consecutive losses</p>
          <p className="mt-2 font-mono text-sm">{risk?.consecutiveLosses ?? "—"}</p>
        </Card>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {(markets?.markets ?? symbols.map((symbol) => ({ symbol }))).map((item) => {
          const symbol = item.symbol;
          const quote = markets?.markets.find((market) => market.symbol === symbol);
          return (
            <Card key={symbol}>
              <div className="flex items-start justify-between">
                <div>
                  <Link href={`/markets/${symbol}`} className="font-mono text-sm text-muted-foreground hover:text-foreground">
                    {quote?.displayName ?? symbol}
                  </Link>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {quote?.last ?? quote?.bid ?? "—"}
                  </p>
                </div>
                <Badge variant={freshnessVariant(quote?.freshness ?? "DISCONNECTED")}>
                  {quote?.resolved === false ? "UNRESOLVED" : (quote?.freshness ?? "DISCONNECTED")}
                </Badge>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 font-mono text-xs text-muted-foreground">
                <div>
                  <p>Bid</p>
                  <p className="text-foreground">{quote?.bid ?? "—"}</p>
                </div>
                <div>
                  <p>Ask</p>
                  <p className="text-foreground">{quote?.ask ?? "—"}</p>
                </div>
                <div>
                  <p>Day</p>
                  <p className="text-foreground">{quote?.dailyChangePct ?? "—"}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 font-mono text-xs text-muted-foreground">
                <div>
                  <p>4H regime</p>
                  <p className="text-foreground">{quote?.regime4h ?? "—"}</p>
                </div>
                <div>
                  <p>1H structure</p>
                  <p className="text-foreground">{quote?.structure1h ?? "—"}</p>
                </div>
                <div>
                  <p>15m momentum</p>
                  <p className="text-foreground">{quote?.momentum15m ?? "—"}</p>
                </div>
                <div>
                  <p>Closest S/R</p>
                  <p className="text-foreground">
                    {quote?.closestSupport ?? "—"} / {quote?.closestResistance ?? "—"}
                  </p>
                </div>
                <div>
                  <p>Opportunity score</p>
                  <p className="text-foreground">
                    {quote?.opportunityScore ?? "—"}
                    {quote?.opportunityLabel ? ` · ${quote.opportunityLabel}` : ""}
                  </p>
                </div>
                <div>
                  <p>Entry status</p>
                  <p className="text-foreground">{quote?.entryStatus ?? quote?.signalState ?? "—"}</p>
                </div>
              </div>
              {quote?.signalExplanation ? (
                <p className="mt-3 font-mono text-xs text-muted-foreground">{quote.signalExplanation}</p>
              ) : null}
            </Card>
          );
        })}
      </section>
    </div>
  );
}
