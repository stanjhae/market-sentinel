"use client";

import type { CreatePlanResponse, ExecutionConfirm, ExecutionPreview, ExecutionStatus, RiskEvaluationDto, RiskStatus, SignalDetailResponse, SignalDto } from "@market-sentinel/contracts";
import { plannedEntryFromZone, PSYCHOLOGY_CHECKLIST_KEYS, type PsychologyChecklist } from "@market-sentinel/domain";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const CHECKLIST_LABELS: Record<keyof PsychologyChecklist, string> = {
  definedEntry: "I have a defined entry trigger.",
  definedStop: "I have a defined stop before entry.",
  minimumRr: "At least minimum R:R exists.",
  notRecovering: "I am not trying to recover the previous loss.",
  notChasing: "I am not chasing a move I missed.",
  knowHtf: "I know the higher-timeframe context.",
  noBlackoutImminent: "No blackout event is imminent.",
  wouldStillTake: "If my previous trade did not exist, would I still take this trade?",
};

function emptyChecklist(): PsychologyChecklist {
  return {
    definedEntry: false,
    definedStop: false,
    minimumRr: false,
    notRecovering: false,
    notChasing: false,
    knowHtf: false,
    noBlackoutImminent: false,
    wouldStillTake: false,
  };
}

export function TradeGateBoard() {
  const searchParams = useSearchParams();
  const signalId = searchParams.get("signalId");
  const [signal, setSignal] = useState<SignalDto | null>(null);
  const [risk, setRisk] = useState<RiskStatus | null>(null);
  const [evaluation, setEvaluation] = useState<RiskEvaluationDto | null>(null);
  const [checklist, setChecklist] = useState<PsychologyChecklist>(emptyChecklist);
  const [result, setResult] = useState<CreatePlanResponse | null>(null);
  const [execution, setExecution] = useState<ExecutionStatus | null>(null);
  const [preview, setPreview] = useState<ExecutionPreview | null>(null);
  const [order, setOrder] = useState<ExecutionConfirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [riskResponse, signalResponse, executionResponse] = await Promise.all([
          apiFetch({ path: "/risk/status" }),
          signalId ? apiFetch({ path: `/signals/${signalId}` }) : Promise.resolve(null),
          apiFetch({ path: "/execution/status" }),
        ]);
        if (riskResponse.ok) {
          const payload = (await riskResponse.json()) as RiskStatus;
          if (!cancelled) setRisk(payload);
        }
        if (signalResponse?.ok) {
          const payload = (await signalResponse.json()) as SignalDetailResponse;
          if (!cancelled) setSignal(payload.signal);
        }
        if (executionResponse.ok) {
          const payload = (await executionResponse.json()) as ExecutionStatus;
          if (!cancelled) setExecution(payload);
        }
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "API unavailable");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [signalId]);

  useEffect(() => {
    if (!signal) {
      return;
    }
    void apiFetch({
      path: "/risk/evaluate-plan",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: signal.symbol,
          direction: signal.direction,
          plannedEntry: plannedEntryFromZone({ low: signal.entryZoneLow, high: signal.entryZoneHigh }),
          stopLoss: signal.invalidationPrice,
          target1: signal.target1,
          riskRewardToT1: signal.riskRewardToT1,
        }),
      },
    })
      .then((response) => (response.ok ? (response.json() as Promise<RiskEvaluationDto>) : null))
      .then((payload) => {
        if (payload) setEvaluation(payload);
      })
      .catch(() => undefined);
  }, [signal]);

  const blocked = Boolean(evaluation && !evaluation.allowed);
  const canApprove = signal?.state === "CONFIRMED" && !blocked;

  async function approve() {
    if (!signal) {
      return;
    }
    const response = await apiFetch({
      path: `/signals/${signal.id}/create-plan`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checklist }),
      },
    });
    const payload = (await response.json()) as CreatePlanResponse;
    setResult(payload);
    if (payload.status === "APPROVED") {
      setSignal((current) => (current ? { ...current, state: "TRADE_PLANNED", entryStatus: "TRADE_PLANNED" } : current));
    }
    if (!response.ok && response.status !== 409) {
      setError("create-plan failed");
    }
  }

  async function previewDemo(args: { planId?: string | null }) {
    if (!signal || previewing || confirming || order?.status === "FILLED") {
      return;
    }
    setPreviewing(true);
    try {
      const response = await apiFetch({
        path: "/execution/preview",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ planId: args.planId ?? result?.planId, signalId: signal.id }),
        },
      });
      const payload = (await response.json()) as ExecutionPreview & { error?: string };
      if (!response.ok) {
        const reasons = payload.blockReasons?.join(", ");
        setError(reasons ? `Demo preview blocked: ${reasons}` : payload.error ?? "Demo preview blocked");
        setPreview(payload.blockReasons ? payload : null);
        return;
      }
      setPreview(payload);
      setError(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmDemo() {
    if (!preview?.nonce || confirming || previewing || order?.status === "FILLED") {
      return;
    }
    setConfirming(true);
    try {
      const response = await apiFetch({
        path: "/execution/confirm",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nonce: preview.nonce }),
        },
      });
      const payload = (await response.json()) as ExecutionConfirm & { error?: string };
      setOrder(payload.status ? payload : null);
      if (!response.ok) {
        const reasons = payload.blockReasons?.join(", ");
        setError(reasons ? `Demo confirm blocked: ${reasons}` : payload.error ?? "Demo confirm blocked");
      }
    } finally {
      setConfirming(false);
    }
  }

  async function logRejection() {
    if (!signal) {
      return;
    }
    await apiFetch({
      path: `/signals/${signal.id}/create-plan`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checklist, logRejection: true }),
      },
    });
  }

  if (!signalId) {
    return <Card><p className="text-sm text-muted-foreground">Select a CONFIRMED or WATCHING signal to open the Trade Gate.</p></Card>;
  }

  return (
    <div className="space-y-4">
      {risk?.newsBlackout ? <Badge variant="stale">NEWS BLACKOUT ACTIVE</Badge> : null}
      {risk && risk.tradingStatus !== "ACTIVE" ? <Badge variant="stale">{risk.tradingStatus.replaceAll("_", " ")}</Badge> : null}
      {error ? <p className="font-mono text-xs text-destructive">{error}</p> : null}
      {!signal ? <Card><p className="text-sm text-muted-foreground">Signal not found.</p></Card> : (
        <>
          <Card>
            <p className="font-mono text-xs uppercase text-muted-foreground">{signal.symbol} · {signal.strategyKey}</p>
            <p className="mt-2 text-lg font-semibold">{signal.direction} · {signal.entryStatus}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">Opportunity score: {signal.score}</p>
          </Card>
          <section className="grid gap-3 md:grid-cols-3">
            <Card>
              <p className="text-xs uppercase text-muted-foreground">Equity</p>
              <p className="mt-2 font-mono text-sm">{risk?.equity ?? "—"}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-muted-foreground">Max risk</p>
              <p className="mt-2 font-mono text-sm">{evaluation?.maxLossUsd ?? "—"} ({evaluation?.maxRiskPct ?? "—"}%)</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-muted-foreground">Size guidance</p>
              <p className="mt-2 font-mono text-sm">{evaluation?.positionSizeUsd ?? "—"}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-muted-foreground">Stop</p>
              <p className="mt-2 font-mono text-sm">{signal.invalidationPrice ?? "—"}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-muted-foreground">R:R</p>
              <p className="mt-2 font-mono text-sm">{signal.riskRewardToT1 ?? evaluation?.expectedR ?? "—"}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-muted-foreground">Min target</p>
              <p className="mt-2 font-mono text-sm">{evaluation?.minTarget ?? signal.target1 ?? "—"}</p>
            </Card>
          </section>
          {evaluation?.blockReasons.length ? (
            <Card>
              <p className="text-sm font-semibold">Block reasons</p>
              <p className="mt-2 font-mono text-xs text-destructive">{evaluation.blockReasons.join(", ")}</p>
            </Card>
          ) : null}
          <Card>
            <p className="text-sm font-semibold">Psychology checklist</p>
            <div className="mt-3 space-y-2">
              {PSYCHOLOGY_CHECKLIST_KEYS.map((key) => (
                <label key={key} className="flex items-start gap-2 font-mono text-xs">
                  <input
                    type="checkbox"
                    checked={checklist[key]}
                    onChange={(event) => setChecklist((current) => ({ ...current, [key]: event.target.checked }))}
                  />
                  <span>{CHECKLIST_LABELS[key]}</span>
                </label>
              ))}
            </div>
          </Card>
          {blocked ? (
            <p className="font-mono text-xs text-muted-foreground">Approve is hidden while a hard risk rule fails.</p>
          ) : signal.state !== "CONFIRMED" ? (
            <p className="font-mono text-xs text-muted-foreground">Approve is hidden until the signal is CONFIRMED.</p>
          ) : (
            <button
              type="button"
              className={cn("rounded-sm border border-border px-3 py-2 font-mono text-xs uppercase", {
                "text-foreground": canApprove,
              })}
              onClick={() => void approve()}
            >
              Approve plan
            </button>
          )}
          <button type="button" className="ml-3 font-mono text-xs uppercase text-muted-foreground" onClick={() => void logRejection()}>
            Log rejected checklist
          </button>
          {result ? (
            <Card>
              <p className="font-mono text-xs">{result.status}</p>
              {result.blockReasons.length > 0 ? <p className="mt-1 text-destructive">{result.blockReasons.join(", ")}</p> : null}
            </Card>
          ) : null}
          {signal.state === "TRADE_PLANNED" || result?.status === "APPROVED" ? (
            <Card>
              <p className="text-sm font-semibold">Demo execution</p>
              {execution && !execution.allowed ? (
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  Demo send is hidden: {execution.blockReasons.join(", ") || "isolation"}.
                </p>
              ) : blocked ? (
                <p className="mt-2 font-mono text-xs text-muted-foreground">Confirm is hidden while a hard risk rule fails.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="font-mono text-xs text-muted-foreground">Leverage 1 · Demo account only. Preview does not place an order.</p>
                  {order?.status === "FILLED" ? (
                    <p className="font-mono text-xs">FILLED{order.etoroOrderId ? ` · ${order.etoroOrderId}` : ""}</p>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={cn("rounded-sm border border-border px-3 py-2 font-mono text-xs uppercase", {
                          "opacity-50": previewing || confirming,
                        })}
                        disabled={previewing || confirming}
                        onClick={() => void previewDemo({ planId: result?.planId })}
                      >
                        {order?.status === "AMBIGUOUS"
                          ? "Resume Demo reconcile"
                          : previewing
                            ? "Previewing…"
                            : "Preview Demo order"}
                      </button>
                      {preview?.allowed && preview.nonce ? (
                        <>
                          <p className="font-mono text-xs text-muted-foreground">
                            Amount {preview.amount ?? "—"} · Stop {preview.stopLoss ?? "—"} · Target {preview.takeProfit ?? "—"}
                          </p>
                          <button
                            type="button"
                            className={cn("rounded-sm border border-border px-3 py-2 font-mono text-xs uppercase", {
                              "text-foreground": !confirming,
                              "opacity-50": confirming,
                            })}
                            disabled={confirming}
                            onClick={() => void confirmDemo()}
                          >
                            {confirming ? "Sending…" : "Confirm Demo send"}
                          </button>
                        </>
                      ) : null}
                    </>
                  )}
                  {order && order.status !== "FILLED" ? (
                    <p className="font-mono text-xs">{order.status}{order.blockReasons.length ? ` · ${order.blockReasons.join(", ")}` : ""}</p>
                  ) : null}
                  {preview && !preview.allowed && preview.blockReasons.length > 0 ? (
                    <p className="font-mono text-xs text-destructive">{preview.blockReasons.join(", ")}</p>
                  ) : null}
                </div>
              )}
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
