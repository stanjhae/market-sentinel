"use client";

import type { AccountResponse, ExecutionConfirm, ExecutionPreview, ExecutionStatus, HistoryResponse, PositionsResponse, RiskStatus, SseEvent } from "@market-sentinel/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { useSentinelEvents } from "./sentinel-stream";

export function AccountBoard() {
  const [account, setAccount] = useState<AccountResponse | null>(null);
  const [positions, setPositions] = useState<PositionsResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [risk, setRisk] = useState<RiskStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [execution, setExecution] = useState<ExecutionStatus | null>(null);
  const [closePreview, setClosePreview] = useState<ExecutionPreview | null>(null);
  const [closeResult, setCloseResult] = useState<ExecutionConfirm | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [previewingClose, setPreviewingClose] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);

  const load = useCallback(async () => {
    const [accountResponse, positionsResponse, historyResponse, riskResponse, executionResponse] = await Promise.all([
      apiFetch({ path: "/account" }),
      apiFetch({ path: "/account/positions" }),
      apiFetch({ path: "/account/history" }),
      apiFetch({ path: "/risk/status" }),
      apiFetch({ path: "/execution/status" }),
    ]);
    if (!accountResponse.ok) {
      throw new Error(`API ${accountResponse.status}`);
    }
    setAccount((await accountResponse.json()) as AccountResponse);
    setPositions(positionsResponse.ok ? ((await positionsResponse.json()) as PositionsResponse) : null);
    setHistory(historyResponse.ok ? ((await historyResponse.json()) as HistoryResponse) : null);
    setRisk(riskResponse.ok ? ((await riskResponse.json()) as RiskStatus) : null);
    setExecution(executionResponse.ok ? ((await executionResponse.json()) as ExecutionStatus) : null);
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

  async function previewClose(args: { positionId: string }) {
    if (previewingClose || confirmingClose) {
      return;
    }
    setPreviewingClose(true);
    setClosingId(args.positionId);
    setCloseResult(null);
    try {
      const response = await apiFetch({
        path: "/execution/close/preview",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ positionId: args.positionId }),
        },
      });
      const payload = (await response.json()) as ExecutionPreview & { error?: string };
      if (!response.ok) {
        const reasons = payload.blockReasons?.join(", ");
        setError(reasons ? `Close preview blocked: ${reasons}` : payload.error ?? "Close preview blocked");
        setClosePreview(payload.blockReasons ? payload : null);
        return;
      }
      setClosePreview(payload);
      setError(null);
    } finally {
      setPreviewingClose(false);
    }
  }

  async function confirmClose() {
    if (!closePreview?.nonce || confirmingClose || previewingClose || closeResult?.status === "FILLED") {
      return;
    }
    setConfirmingClose(true);
    try {
      const response = await apiFetch({
        path: "/execution/close/confirm",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nonce: closePreview.nonce }),
        },
      });
      const payload = (await response.json()) as ExecutionConfirm & { error?: string };
      setCloseResult(payload.status ? payload : null);
      if (response.ok) {
        await load();
      } else {
        const reasons = payload.blockReasons?.join(", ");
        setError(reasons ? `Close confirm blocked: ${reasons}` : payload.error ?? "Close confirm blocked");
      }
    } finally {
      setConfirmingClose(false);
    }
  }

  async function sync() {
    setSyncing(true);
    try {
      await apiFetch({ path: "/account/sync", init: { method: "POST" } });
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
              <div key={position.etoroPositionId} className="grid grid-cols-2 gap-2 md:grid-cols-7">
                <p>{position.symbol ?? position.instrumentId}</p>
                <p>{position.direction}</p>
                <p>{position.openPrice ?? "—"}</p>
                <p>{position.investedAmount ?? "—"}</p>
                <p>{position.unrealizedPnl ?? "—"}</p>
                <p>Fees {position.fees ?? "—"}</p>
                {execution?.allowed && account?.accountType === "DEMO" ? (
                  <button
                    type="button"
                    className={cn("text-left uppercase text-foreground", {
                      "opacity-50": previewingClose || confirmingClose,
                    })}
                    disabled={previewingClose || confirmingClose}
                    onClick={() => void previewClose({ positionId: position.etoroPositionId })}
                  >
                    {previewingClose && closingId === position.etoroPositionId ? "Previewing…" : "Preview close"}
                  </button>
                ) : (
                  <p className="text-muted-foreground">—</p>
                )}
              </div>
            ))}
          </div>
        )}
        {execution && !execution.allowed ? (
          <p className="mt-2 font-mono text-xs text-muted-foreground">Demo close is hidden unless the account is Demo and execution is enabled.</p>
        ) : null}
        {closePreview && !closePreview.allowed && closePreview.blockReasons.length > 0 ? (
          <p className="mt-2 font-mono text-xs text-destructive">{closePreview.blockReasons.join(", ")}</p>
        ) : null}
        {closePreview?.allowed && closingId && closeResult?.status !== "FILLED" ? (
          <div className="mt-3 space-y-2">
            <p className="font-mono text-xs text-muted-foreground">Confirm full close of {closingId}. This sends a Demo close order.</p>
            <button
              type="button"
              className={cn("rounded-sm border border-border px-3 py-2 font-mono text-xs uppercase", {
                "opacity-50": confirmingClose,
              })}
              disabled={confirmingClose}
              onClick={() => void confirmClose()}
            >
              {confirmingClose ? "Sending…" : "Confirm Demo close"}
            </button>
            {closeResult ? <p className="font-mono text-xs">{closeResult.status}{closeResult.blockReasons.length ? ` · ${closeResult.blockReasons.join(", ")}` : ""}</p> : null}
          </div>
        ) : null}
        {closeResult?.status === "FILLED" ? <p className="mt-2 font-mono text-xs">FILLED</p> : null}
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
