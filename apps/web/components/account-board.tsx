"use client";

import type { AccountResponse, HistoryResponse, PositionsResponse, RiskStatus, SseEvent } from "@market-sentinel/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { API_BASE_URL } from "@/lib/api";
import { useCallback, useEffect, useState } from "react";
import { useSentinelEvents } from "./sentinel-stream";

export function AccountBoard() {
  const [account, setAccount] = useState<AccountResponse | null>(null);
  const [positions, setPositions] = useState<PositionsResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [risk, setRisk] = useState<RiskStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const [accountResponse, positionsResponse, historyResponse, riskResponse] = await Promise.all([
      fetch(`${API_BASE_URL}/account`),
      fetch(`${API_BASE_URL}/account/positions`),
      fetch(`${API_BASE_URL}/account/history`),
      fetch(`${API_BASE_URL}/risk/status`),
    ]);
    if (!accountResponse.ok) {
      throw new Error(`API ${accountResponse.status}`);
    }
    setAccount((await accountResponse.json()) as AccountResponse);
    setPositions(positionsResponse.ok ? ((await positionsResponse.json()) as PositionsResponse) : null);
    setHistory(historyResponse.ok ? ((await historyResponse.json()) as HistoryResponse) : null);
    setRisk(riskResponse.ok ? ((await riskResponse.json()) as RiskStatus) : null);
    setError(null);
  }, []);

  useEffect(() => {
    void load().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "API unavailable");
    });
  }, [load]);

  const onStreamEvent = useCallback((event: SseEvent) => {
    if (event.type === "account" || event.type === "risk") {
      void load().catch(() => undefined);
    }
  }, [load]);
  useSentinelEvents({ onEvent: onStreamEvent });

  async function sync() {
    setSyncing(true);
    try {
      await fetch(`${API_BASE_URL}/account/sync`, { method: "POST" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      {risk && risk.tradingStatus !== "ACTIVE" ? (
        <Card>
          <Badge variant="stale">{risk.tradingStatus.replaceAll("_", " ")}</Badge>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Daily P/L {risk.dailyPnl ?? "—"} · Consecutive losses {risk.consecutiveLosses}
          </p>
        </Card>
      ) : null}
      <section className="grid gap-3 md:grid-cols-4">
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Equity</p>
          <p className="mt-2 font-mono text-sm">{account?.equity ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Available cash</p>
          <p className="mt-2 font-mono text-sm">{account?.availableCash ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Invested</p>
          <p className="mt-2 font-mono text-sm">{account?.invested ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Unrealized P/L</p>
          <p className="mt-2 font-mono text-sm">{account?.unrealizedPnl ?? "—"}</p>
        </Card>
      </section>
      <div className="flex items-center gap-3">
        <button type="button" className="font-mono text-xs uppercase text-foreground" onClick={() => void sync()} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync account"}
        </button>
        {error ? <p className="font-mono text-xs text-destructive">{error}</p> : null}
        {account && !account.available ? <p className="font-mono text-xs text-muted-foreground">No account snapshot yet.</p> : null}
      </div>
      <Card>
        <p className="text-sm font-semibold">Open positions</p>
        {(positions?.positions.length ?? 0) === 0 ? (
          <p className="mt-2 font-mono text-xs text-muted-foreground">No open positions.</p>
        ) : (
          <div className="mt-3 space-y-2 font-mono text-xs">
            {positions?.positions.map((position) => (
              <div key={position.etoroPositionId} className="grid grid-cols-2 gap-2 md:grid-cols-6">
                <p>{position.symbol ?? position.instrumentId}</p>
                <p>{position.direction}</p>
                <p>{position.openPrice ?? "—"}</p>
                <p>{position.investedAmount ?? "—"}</p>
                <p>{position.unrealizedPnl ?? "—"}</p>
                <p>Fees {position.fees ?? "—"}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card>
        <p className="text-sm font-semibold">Closed history</p>
        {history?.historyUnavailable ? (
          <p className="mt-2 font-mono text-xs text-muted-foreground">History unavailable: eToro returned InsufficientPermissions for this key.</p>
        ) : (history?.trades.length ?? 0) === 0 ? (
          <p className="mt-2 font-mono text-xs text-muted-foreground">No closed trades in the lookback window.</p>
        ) : (
          <div className="mt-3 space-y-2 font-mono text-xs">
            {history?.trades.map((trade) => (
              <div key={trade.etoroPositionId} className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <p>{trade.symbol ?? trade.instrumentId}</p>
                <p>{trade.direction}</p>
                <p>{trade.closedAt ?? "—"}</p>
                <p>{trade.realizedPnl ?? "—"}</p>
                <p>Fees {trade.fees ?? "—"}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
