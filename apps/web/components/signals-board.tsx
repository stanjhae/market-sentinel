"use client";

import type { SignalDto, SignalsResponse, SseEvent } from "@market-sentinel/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSentinelEvents } from "./sentinel-stream";

const STRATEGIES = ["breakdown-retest", "sweep-reclaim", "trend-pullback", "do-not-chase"] as const;
const STATES = ["DETECTED", "WATCHING", "CONFIRMED", "TRADE_PLANNED", "INVALIDATED", "EXPIRED", "DISMISSED"] as const;

export function SignalsBoard() {
  const [payload, setPayload] = useState<SignalsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<"active" | "history">("active");
  const [instrument, setInstrument] = useState("");
  const [strategy, setStrategy] = useState("");
  const [direction, setDirection] = useState("");
  const [state, setState] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [minScore, setMinScore] = useState("");
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ scope });
    if (instrument) params.set("instrument", instrument);
    if (strategy) params.set("strategy", strategy);
    if (direction) params.set("direction", direction);
    if (state) params.set("state", state);
    if (timeframe) params.set("timeframe", timeframe);
    if (minScore) params.set("minScore", minScore);
    return params.toString();
  }, [scope, instrument, strategy, direction, state, timeframe, minScore]);

  const load = useCallback(async () => {
    const response = await apiFetch({ path: `/signals?${query}` });
    if (!response.ok) {
      throw new Error(`API ${response.status}`);
    }
    return (await response.json()) as SignalsResponse;
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    void load()
      .then((next) => {
        if (!cancelled) {
          setPayload(next);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "API unavailable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const onStreamEvent = useCallback(
    (event: SseEvent) => {
      if (event.type === "signal" || event.type === "alert") {
        void load()
          .then((next) => {
            setPayload(next);
            setError(null);
          })
          .catch(() => undefined);
      }
    },
    [load],
  );
  useSentinelEvents({ onEvent: onStreamEvent });

  async function dismiss(args: { id: string }) {
    if (dismissingId) {
      return;
    }
    setDismissingId(args.id);
    try {
      const response = await apiFetch({ path: `/signals/${args.id}/dismiss`, init: { method: "POST" } });
      if (!response.ok && response.status !== 409) {
        throw new Error(`API ${response.status}`);
      }
      const next = await apiFetch({ path: `/signals?${query}` });
      if (next.ok) {
        setPayload((await next.json()) as SignalsResponse);
      } else {
        setPayload((current) =>
          current
            ? {
                ...current,
                signals:
                  scope === "active"
                    ? current.signals.filter((signal) => signal.id !== args.id)
                    : current.signals.map((signal) => (signal.id === args.id ? { ...signal, state: "DISMISSED" as const, entryStatus: "DISMISSED" } : signal)),
              }
            : current,
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dismiss failed");
    } finally {
      setDismissingId(null);
    }
  }

  const rows = payload?.signals ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select className="rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs" value={scope} onChange={(event) => setScope(event.target.value as "active" | "history")}>
          <option value="active">Active</option>
          <option value="history">History</option>
        </select>
        <input
          className="w-24 rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs"
          placeholder="Instrument"
          value={instrument}
          onChange={(event) => setInstrument(event.target.value.toUpperCase())}
        />
        <select className="rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs" value={strategy} onChange={(event) => setStrategy(event.target.value)}>
          <option value="">Strategy</option>
          {STRATEGIES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select className="rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs" value={direction} onChange={(event) => setDirection(event.target.value)}>
          <option value="">Direction</option>
          <option value="LONG">LONG</option>
          <option value="SHORT">SHORT</option>
          <option value="NEUTRAL">NEUTRAL</option>
        </select>
        <select className="rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs" value={state} onChange={(event) => setState(event.target.value)}>
          <option value="">State</option>
          {STATES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select className="rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs" value={timeframe} onChange={(event) => setTimeframe(event.target.value)}>
          <option value="">Timeframe</option>
          <option value="15m">15m</option>
          <option value="1h">1h</option>
          <option value="4h">4h</option>
        </select>
        <input
          className="w-20 rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs"
          placeholder="Min score"
          value={minScore}
          onChange={(event) => setMinScore(event.target.value)}
        />
      </div>

      {payload?.staleStream || error ? (
        <Card>
          <p className="text-sm text-muted-foreground">{error ?? "Stream is stale. Signal generation is frozen until quotes resume."}</p>
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">No signals match these filters.</p>
        </Card>
      ) : (
        rows.map((signal) => (
          <SignalCard key={signal.id} signal={signal} dismissing={dismissingId === signal.id} onDismiss={dismiss} />
        ))
      )}
    </div>
  );
}

function SignalCard(args: { signal: SignalDto; dismissing: boolean; onDismiss: (args: { id: string }) => Promise<void> }) {
  const signal = args.signal;
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/markets/${signal.symbol}`} className="font-mono text-sm text-muted-foreground hover:text-foreground">
            {signal.symbol}
          </Link>
          <p className="mt-1 font-mono text-xs uppercase text-muted-foreground">{signal.detectedAt}</p>
        </div>
        <div className="flex gap-2">
          <Badge>{signal.direction}</Badge>
          <Badge variant={signal.state === "CONFIRMED" ? "live" : signal.state === "WATCHING" ? "stale" : "default"}>
            {signal.state}
          </Badge>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 font-mono text-xs text-muted-foreground md:grid-cols-4">
        <div>
          <p>Setup</p>
          <p className="text-foreground">{signal.strategyKey}</p>
        </div>
        <div>
          <p>Score</p>
          <p className="text-foreground">
            {signal.score} · {signal.confidenceLabel}
          </p>
        </div>
        <div>
          <p>Entry status</p>
          <p className="text-foreground">{signal.entryStatus}</p>
        </div>
        <div>
          <p>Entry zone</p>
          <p className="text-foreground">{signal.entryZoneLow && signal.entryZoneHigh ? `${signal.entryZoneLow}–${signal.entryZoneHigh}` : "—"}</p>
        </div>
        <div>
          <p>Invalidation</p>
          <p className="text-foreground">{signal.invalidationPrice ?? "—"}</p>
        </div>
        <div>
          <p>Next target</p>
          <p className="text-foreground">{signal.target1 ?? "—"}</p>
        </div>
        <div>
          <p>Timeframe</p>
          <p className="text-foreground">{signal.triggerTimeframe}</p>
        </div>
        <div>
          <p>Outcome</p>
          <p className="text-foreground">{signal.state === "INVALIDATED" || signal.state === "EXPIRED" || signal.state === "DISMISSED" || signal.state === "CLOSED" ? signal.state : "—"}</p>
        </div>
      </div>
      <div className="mt-3 flex gap-4">
        {signal.state === "WATCHING" || signal.state === "CONFIRMED" ? (
          <Link href={`/trade-gate?signalId=${signal.id}`} className="font-mono text-xs uppercase text-foreground hover:text-live">
            Open Trade Gate
          </Link>
        ) : null}
        {signal.state !== "DISMISSED" && signal.state !== "CLOSED" && signal.state !== "INVALIDATED" && signal.state !== "EXPIRED" ? (
          <button
            type="button"
            className="font-mono text-xs uppercase text-destructive disabled:opacity-50"
            disabled={args.dismissing}
            onClick={() => void args.onDismiss({ id: signal.id })}
          >
            {args.dismissing ? "Dismissing…" : "Dismiss"}
          </button>
        ) : null}
      </div>
    </Card>
  );
}
