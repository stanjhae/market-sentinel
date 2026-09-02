"use client";

import type {
  AnalyticsInstrumentsResponse,
  AnalyticsPsychologyResponse,
  AnalyticsSetupsResponse,
  AnalyticsSummaryResponse,
} from "@market-sentinel/contracts";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useEffect, useState } from "react";

function Metric(args: { label: string; value: string | null | undefined }) {
  return (
    <Card>
      <p className="text-xs uppercase text-muted-foreground">{args.label}</p>
      <p className="mt-2 font-mono text-sm">{args.value ?? "—"}</p>
    </Card>
  );
}

export function AnalyticsBoard() {
  const [summary, setSummary] = useState<AnalyticsSummaryResponse | null>(null);
  const [setups, setSetups] = useState<AnalyticsSetupsResponse | null>(null);
  const [instruments, setInstruments] = useState<AnalyticsInstrumentsResponse | null>(null);
  const [psychology, setPsychology] = useState<AnalyticsPsychologyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [summaryResponse, setupsResponse, instrumentsResponse, psychologyResponse] = await Promise.all([
          apiFetch({ path: "/analytics/summary" }),
          apiFetch({ path: "/analytics/setups" }),
          apiFetch({ path: "/analytics/instruments" }),
          apiFetch({ path: "/analytics/psychology" }),
        ]);
        if (!summaryResponse.ok) {
          throw new Error(`API ${summaryResponse.status}`);
        }
        if (!cancelled) {
          setSummary((await summaryResponse.json()) as AnalyticsSummaryResponse);
          setSetups(setupsResponse.ok ? ((await setupsResponse.json()) as AnalyticsSetupsResponse) : null);
          setInstruments(instrumentsResponse.ok ? ((await instrumentsResponse.json()) as AnalyticsInstrumentsResponse) : null);
          setPsychology(psychologyResponse.ok ? ((await psychologyResponse.json()) as AnalyticsPsychologyResponse) : null);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "API unavailable");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (!summary) {
    return <p className="text-sm text-muted-foreground">Loading analytics…</p>;
  }
  if (summary.empty || !summary.summary) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">
          No closed journal trades yet. Analytics stay empty so a blank book is not mistaken for a track record.
        </p>
      </Card>
    );
  }

  const stats = summary.summary;
  const mind = psychology?.psychology;

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="Net P/L" value={stats.netPnl} />
        <Metric label="Win rate" value={stats.winRate} />
        <Metric label="Expectancy R" value={stats.expectancyR} />
        <Metric label="Profit factor" value={stats.profitFactor} />
        <Metric label="Avg win" value={stats.averageWin} />
        <Metric label="Avg loss" value={stats.averageLoss} />
        <Metric label="Payoff" value={stats.payoffRatio} />
        <Metric label="Max drawdown" value={stats.maxDrawdown} />
        <Metric label="Avg MAE" value={stats.averageMae} />
        <Metric label="Avg MFE" value={stats.averageMfe} />
        <Metric label="Adherence" value={stats.ruleAdherenceRate} />
        <Metric label="Fees % gross" value={stats.feesPctOfGross} />
      </section>
      <section className="grid gap-3 md:grid-cols-2">
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Gated</p>
          <p className="mt-2 font-mono text-sm">
            {stats.gated.count} · {stats.gated.netPnl} · {stats.gated.expectancyR ?? "—"}R
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Ungated</p>
          <p className="mt-2 font-mono text-sm">
            {stats.ungated.count} · {stats.ungated.netPnl} · {stats.ungated.expectancyR ?? "—"}R
          </p>
        </Card>
      </section>
      <Card>
        <p className="text-xs uppercase text-muted-foreground">By setup</p>
        <div className="mt-3 space-y-2">
          {(setups?.setups ?? []).map((bucket) => (
            <p key={bucket.key} className="font-mono text-xs">
              {bucket.key}: {bucket.count} · {bucket.netPnl ?? "—"} · {bucket.expectancyR ?? "—"}R
            </p>
          ))}
        </div>
      </Card>
      <Card>
        <p className="text-xs uppercase text-muted-foreground">By instrument</p>
        <div className="mt-3 space-y-2">
          {(instruments?.instruments ?? []).map((bucket) => (
            <p key={bucket.key} className="font-mono text-xs">
              {bucket.key}: {bucket.count} · {bucket.netPnl ?? "—"} · {bucket.expectancyR ?? "—"}R
            </p>
          ))}
        </div>
      </Card>
      {mind ? (
        <section className="grid gap-3 md:grid-cols-2">
          <Metric label="Followed plan" value={`${mind.followed.count} / ${mind.followed.netPnl}`} />
          <Metric label="Broke plan" value={`${mind.broken.count} / ${mind.broken.netPnl}`} />
          <Metric label="Discipline ≥ 70" value={`${mind.disciplineAtOrAbove.count} / ${mind.disciplineAtOrAbove.netPnl}`} />
          <Metric label="Discipline < 70" value={`${mind.disciplineBelow.count} / ${mind.disciplineBelow.netPnl}`} />
          <Metric label="After win" value={`${mind.afterWin.count} / ${mind.afterWin.netPnl}`} />
          <Metric label="After loss" value={`${mind.afterLoss.count} / ${mind.afterLoss.netPnl}`} />
          <Metric label="Long" value={`${mind.long.count} / ${mind.long.netPnl}`} />
          <Metric label="Short" value={`${mind.short.count} / ${mind.short.netPnl}`} />
          <Metric label="Trend aligned" value={`${mind.trendAligned.count} / ${mind.trendAligned.netPnl}`} />
          <Metric label="Countertrend" value={`${mind.countertrend.count} / ${mind.countertrend.netPnl}`} />
        </section>
      ) : null}
    </div>
  );
}
