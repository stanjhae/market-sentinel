"use client";

import type { AlertDto, AlertsResponse } from "@market-sentinel/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { API_BASE_URL } from "@/lib/api";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSentinelEvents, useSentinelStream } from "./sentinel-stream";

export function AlertsInbox() {
  const [payload, setPayload] = useState<AlertsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [streamStale, setStreamStale] = useState(false);
  const { setUnreadCount } = useSentinelStream();

  const load = useCallback(async () => {
    const response = await fetch(`${API_BASE_URL}/alerts${unreadOnly ? "?unread=true" : ""}`);
    if (!response.ok) {
      throw new Error(`API ${response.status}`);
    }
    const next = (await response.json()) as AlertsResponse;
    setPayload(next);
    setStreamStale(next.staleStream);
    setUnreadCount({ count: next.unreadCount });
    setError(null);
  }, [setUnreadCount, unreadOnly]);

  useEffect(() => {
    let cancelled = false;
    void load().catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : "API unavailable");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useSentinelEvents({
    onEvent: useCallback(
      (event) => {
        if (event.type === "alert") {
          void load().catch(() => undefined);
        }
        if (event.type === "stream") {
          setStreamStale(event.payload.streamStatus === "STALE" || event.payload.streamStatus === "DISCONNECTED");
        }
      },
      [load],
    ),
  });

  async function markRead(args: { id: string }) {
    const response = await fetch(`${API_BASE_URL}/alerts/${args.id}/read`, { method: "POST" });
    if (!response.ok && response.status !== 404) {
      throw new Error(`API ${response.status}`);
    }
    await load();
  }

  async function markAll() {
    await fetch(`${API_BASE_URL}/alerts/read-all`, { method: "POST" });
    await load();
  }

  const rows = payload?.alerts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={cn("rounded-sm border border-border px-2 py-1 font-mono text-xs uppercase", {
            "bg-card text-foreground": unreadOnly,
            "bg-background text-muted-foreground": !unreadOnly,
          })}
          onClick={() => setUnreadOnly((current) => !current)}
        >
          Unread only
        </button>
        <button type="button" className="font-mono text-xs uppercase text-muted-foreground hover:text-foreground" onClick={() => void markAll()}>
          Mark all read
        </button>
      </div>

      {streamStale || error ? (
        <Card>
          <p className="text-sm text-muted-foreground">{error ?? "Stream is stale. New alerts pause until quotes resume."}</p>
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">{payload?.available === false ? "Alerts are unavailable." : "No alerts yet."}</p>
        </Card>
      ) : (
        rows.map((alert) => <AlertCard key={alert.id} alert={alert} onRead={markRead} />)
      )}
    </div>
  );
}

function AlertCard(args: { alert: AlertDto; onRead: (args: { id: string }) => Promise<void> }) {
  const alert = args.alert;
  const unread = alert.readAt === null;
  return (
    <Card className={cn({ "border-live/40": unread })}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/markets/${alert.symbol}`} className="font-mono text-sm text-muted-foreground hover:text-foreground">
            {alert.symbol}
          </Link>
          <p className="mt-1 text-sm font-semibold">{alert.title}</p>
          <p className="mt-2 text-sm text-muted-foreground">{alert.body}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant={unread ? "live" : "default"}>{alert.type}</Badge>
          <p className="font-mono text-xs text-muted-foreground">{alert.createdAt}</p>
        </div>
      </div>
      {unread ? (
        <button
          type="button"
          className="mt-3 font-mono text-xs uppercase text-muted-foreground hover:text-foreground"
          onClick={() => void args.onRead({ id: alert.id })}
        >
          Mark read
        </button>
      ) : null}
    </Card>
  );
}
