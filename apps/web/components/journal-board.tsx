"use client";

import type { JournalListResponse, SseEvent } from "@market-sentinel/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSentinelEvents } from "./sentinel-stream";

export function JournalBoard() {
  const [data, setData] = useState<JournalListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await apiFetch({ path: "/journal" });
    if (!response.ok) {
      throw new Error(`API ${response.status}`);
    }
    setData((await response.json()) as JournalListResponse);
    setError(null);
  }, []);

  useEffect(() => {
    void load().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "API unavailable");
    });
  }, [load]);

  const onStreamEvent = useCallback((event: SseEvent) => {
    if (event.type === "account") {
      void load().catch(() => undefined);
    }
  }, [load]);
  useSentinelEvents({ onEvent: onStreamEvent });

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Loading journal…</p>;
  }
  return (
    <div className="space-y-4">
      {data.historyUnavailable ? (
        <Card>
          <Badge variant="stale">History unavailable</Badge>
          <p className="mt-2 text-sm text-muted-foreground">
            Closed-trade history needs a real-environment credential. Open positions still journal when they appear.
          </p>
        </Card>
      ) : null}
      {data.entries.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">No journal rows yet. Manual eToro trades appear here after the next account sync.</p>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="font-mono text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="pb-2 pr-3">Time</th>
                <th className="pb-2 pr-3">Instrument</th>
                <th className="pb-2 pr-3">Direction</th>
                <th className="pb-2 pr-3">Setup</th>
                <th className="pb-2 pr-3">P/L $</th>
                <th className="pb-2 pr-3">P/L R</th>
                <th className="pb-2 pr-3">Plan</th>
                <th className="pb-2 pr-3">MAE</th>
                <th className="pb-2 pr-3">MFE</th>
                <th className="pb-2 pr-3">Shot</th>
                <th className="pb-2">Emotion</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => (
                <tr key={entry.id} className="border-t border-border">
                  <td className="py-2 pr-3 font-mono text-xs">
                    <Link href={`/journal/${entry.id}`} className="hover:text-foreground">
                      {entry.openedAt ? entry.openedAt.slice(0, 16).replace("T", " ") : "—"}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">{entry.symbol ?? "—"}</td>
                  <td className="py-2 pr-3">{entry.direction}</td>
                  <td className="py-2 pr-3">{entry.setupKey ?? "—"}</td>
                  <td className="py-2 pr-3 font-mono">{entry.realizedPnl ?? "—"}</td>
                  <td className="py-2 pr-3 font-mono">{entry.resultR ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <Badge variant={entry.matchStatus === "UNGATED" ? "stale" : entry.matchStatus === "UNMATCHED" ? "disconnected" : "live"}>
                      {entry.matchStatus === "LINKED" && entry.followedPlan === false ? "broke plan" : entry.matchStatus}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 font-mono">{entry.maeUsd ?? "—"}</td>
                  <td className="py-2 pr-3 font-mono">{entry.mfeUsd ?? "—"}</td>
                  <td className="py-2 pr-3">{entry.screenshotUrl ? "yes" : "—"}</td>
                  <td className="py-2 text-xs text-muted-foreground">{entry.postTradeEmotion ?? entry.preTradeEmotion ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
