"use client";

import type {
  BacktestRunResponse,
  ReplayFrameResponse,
} from "@market-sentinel/contracts";
import { WATCHLIST, type CanonicalSymbol, type Timeframe } from "@market-sentinel/domain";
import { CandleChart } from "@/components/candle-chart";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { API_BASE_URL } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

const TIMEFRAMES: Timeframe[] = ["15m", "1h", "4h"];

function isoDateUtc(args: { value: string }): string | undefined {
  if (!args.value) {
    return undefined;
  }
  const raw = args.value.trim();
  const normalized = /Z$|[+-]\d{2}:\d{2}$/.test(raw)
    ? raw
    : raw.length === 16
      ? `${raw}:00.000Z`
      : `${raw}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function ReplayBoard() {
  const [symbol, setSymbol] = useState<CanonicalSymbol>("US30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [frame, setFrame] = useState<ReplayFrameResponse | null>(null);
  const [backtest, setBacktest] = useState<BacktestRunResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stopLoss, setStopLoss] = useState("");
  const [target1, setTarget1] = useState("");
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playIndexRef = useRef(0);
  const barCountRef = useRef(0);
  const timeframeRef = useRef<Timeframe>("15m");
  const requestGenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  async function loadFrame(args: { id: string; nextIndex: number; nextTimeframe: Timeframe }) {
    const generation = requestGenRef.current + 1;
    requestGenRef.current = generation;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(
        `${API_BASE_URL}/replay/sessions/${args.id}/frame?index=${args.nextIndex}&timeframe=${args.nextTimeframe}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        throw new Error(`API ${response.status}`);
      }
      const body = (await response.json()) as ReplayFrameResponse;
      if (generation !== requestGenRef.current) {
        return;
      }
      setFrame(body);
      setIndex(body.index);
      playIndexRef.current = body.index;
      barCountRef.current = body.barCount;
      setError(null);
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") {
        return;
      }
      throw cause;
    }
  }

  async function startReplay() {
    setLoading(true);
    setPlaying(false);
    try {
      const response = await fetch(`${API_BASE_URL}/replay/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol,
          from: isoDateUtc({ value: from }),
          to: isoDateUtc({ value: to }),
        }),
      });
      if (!response.ok) {
        throw new Error(`API ${response.status}`);
      }
      const body = (await response.json()) as BacktestRunResponse;
      if (!body.run) {
        throw new Error("Replay session was not created");
      }
      setSessionId(body.run.id);
      setBacktest(null);
      playIndexRef.current = 0;
      barCountRef.current = body.run.barCount;
      await loadFrame({ id: body.run.id, nextIndex: 0, nextTimeframe: timeframe });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Replay unavailable");
    } finally {
      setLoading(false);
    }
  }

  async function runBacktest() {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/backtests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol,
          from: isoDateUtc({ value: from }),
          to: isoDateUtc({ value: to }),
          walkForwardMode: "split",
        }),
      });
      if (!response.ok) {
        throw new Error(`API ${response.status}`);
      }
      setBacktest((await response.json()) as BacktestRunResponse);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Backtest unavailable");
    } finally {
      setLoading(false);
    }
  }

  async function stepBy(args: { delta: number }) {
    if (!sessionId || !frame) {
      return;
    }
    const next = Math.min(Math.max(0, index + args.delta), Math.max(0, frame.barCount - 1));
    await loadFrame({ id: sessionId, nextIndex: next, nextTimeframe: timeframe });
  }

  async function paperTrade() {
    if (!sessionId || !stopLoss || !target1) {
      return;
    }
    const response = await fetch(`${API_BASE_URL}/replay/sessions/${sessionId}/paper-trade?index=${index}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ direction: "LONG", stopLoss, target1 }),
    });
    if (response.ok) {
      setFrame((await response.json()) as ReplayFrameResponse);
    }
  }

  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);

  useEffect(() => {
    if (!playing || !sessionId) {
      if (playRef.current) {
        clearInterval(playRef.current);
        playRef.current = null;
      }
      return;
    }
    playRef.current = setInterval(() => {
      const next = playIndexRef.current + 1;
      if (next >= barCountRef.current) {
        setPlaying(false);
        return;
      }
      playIndexRef.current = next;
      void loadFrame({ id: sessionId, nextIndex: next, nextTimeframe: timeframeRef.current }).catch(() => {
        setPlaying(false);
      });
    }, 400);
    return () => {
      if (playRef.current) {
        clearInterval(playRef.current);
        playRef.current = null;
      }
    };
  }, [playing, sessionId]);

  useEffect(() => {
    if (sessionId) {
      void loadFrame({ id: sessionId, nextIndex: playIndexRef.current, nextTimeframe: timeframe });
    }
  }, [timeframe]);

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-xs uppercase text-muted-foreground">
            Instrument
            <select
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value as CanonicalSymbol)}
            >
              {WATCHLIST.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs uppercase text-muted-foreground">
            From (UTC)
            <input
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="text-xs uppercase text-muted-foreground">
            To (UTC)
            <input
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1 text-sm hover:bg-muted"
              onClick={() => void startReplay()}
              disabled={loading}
            >
              Start replay
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1 text-sm hover:bg-muted"
              onClick={() => void runBacktest()}
              disabled={loading}
            >
              Run backtest
            </button>
          </div>
        </div>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {frame?.empty || frame?.emptyReason ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            {frame.emptyReason === "insufficient-history"
              ? "Not enough finalized candles for indicator warmup (need 228 15m bars)."
              : "No finalized history for this range. Replay stays empty instead of inventing bars."}
          </p>
        </Card>
      ) : null}

      {frame && !frame.empty ? (
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button type="button" className="rounded-md border border-border px-3 py-1 text-sm" onClick={() => setPlaying((value) => !value)}>
              {playing ? "Pause" : "Play"}
            </button>
            <button type="button" className="rounded-md border border-border px-3 py-1 text-sm" onClick={() => void stepBy({ delta: 1 })}>
              Step
            </button>
            {TIMEFRAMES.map((item) => (
              <button
                key={item}
                type="button"
                className={cn("rounded-md border px-3 py-1 text-sm", {
                  "border-foreground bg-muted": timeframe === item,
                  "border-border": timeframe !== item,
                })}
                onClick={() => setTimeframe(item)}
              >
                {item}
              </button>
            ))}
            <Badge>{`Bar ${frame.index + 1} / ${frame.barCount}`}</Badge>
            {frame.openTimeUtc ? <span className="font-mono text-xs text-muted-foreground">{frame.openTimeUtc}</span> : null}
          </div>
          <CandleChart
            candles={frame.candles}
            zones={frame.zones}
            indicators={frame.indicators}
            signals={frame.signals.map((signal) => ({
              id: signal.id,
              entryLow: signal.entryZoneLow,
              entryHigh: signal.entryZoneHigh,
              invalidation: signal.invalidationPrice,
              target: signal.target1,
            }))}
          />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Signals as of this bar</p>
              {frame.signals.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">None yet.</p>
              ) : (
                <ul className="mt-2 space-y-1 font-mono text-xs">
                  {frame.signals.map((signal) => (
                    <li key={signal.id}>
                      {signal.strategyKey} {signal.direction} {signal.state} {signal.score}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase text-muted-foreground">Paper trade (session only)</p>
              <input
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                placeholder="Stop"
                value={stopLoss}
                onChange={(event) => setStopLoss(event.target.value)}
              />
              <input
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                placeholder="Target"
                value={target1}
                onChange={(event) => setTarget1(event.target.value)}
              />
              <button type="button" className="rounded-md border border-border px-3 py-1 text-sm" onClick={() => void paperTrade()}>
                Paper long
              </button>
              {frame.paperTrades.length > 0 ? (
                <p className="font-mono text-xs text-muted-foreground">
                  {frame.paperTrades.map((trade) => `${trade.status} ${trade.realizedPnl ?? ""}`).join(" · ")}
                </p>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {backtest?.run ? (
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Backtest</p>
          {backtest.run.emptyReason || !backtest.run.metrics || backtest.run.metrics.empty ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {backtest.run.emptyReason === "insufficient-history"
                ? "Not enough finalized candles for indicator warmup."
                : "No closed simulated trades in this range."}
            </p>
          ) : (
            <div className="mt-2 grid gap-2 md:grid-cols-4 font-mono text-sm">
              <p>Win rate {backtest.run.metrics.winRate ?? "—"}</p>
              <p>Expectancy R {backtest.run.metrics.expectancyR ?? "—"}</p>
              <p>Profit factor {backtest.run.metrics.profitFactor ?? "—"}</p>
              <p>Drawdown {backtest.run.metrics.maxDrawdown ?? "—"}</p>
            </div>
          )}
          {backtest.run.windows.length > 0 ? (
            <ul className="mt-3 space-y-1 font-mono text-xs text-muted-foreground">
              {backtest.run.windows.map((window) => (
                <li key={`${window.kind}-${window.from}`}>
                  {window.kind} {window.from} → {window.to} · wr {window.metrics.winRate ?? "—"}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
