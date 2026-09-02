"use client";

import type { JournalDetailResponse } from "@market-sentinel/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { API_BASE_URL } from "@/lib/api";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export function JournalDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<JournalDetailResponse | null>(null);
  const [notes, setNotes] = useState("");
  const [emotion, setEmotion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`${API_BASE_URL}/journal/${id}`);
    if (!response.ok) {
      throw new Error(`API ${response.status}`);
    }
    const payload = (await response.json()) as JournalDetailResponse;
    setDetail(payload);
    setNotes(payload.entry?.notes ?? "");
    setEmotion(payload.entry?.postTradeEmotion ?? "");
    setError(null);
  }, [id]);

  useEffect(() => {
    void load().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "API unavailable");
    });
  }, [load]);

  async function save(args: { body: Record<string, unknown> }) {
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/journal/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args.body),
      });
      if (!response.ok) {
        throw new Error(`API ${response.status}`);
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function uploadScreenshot(args: { file: File }) {
    const form = new FormData();
    form.append("file", args.file);
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/journal/${id}/screenshot`, { method: "POST", body: form });
      if (!response.ok) {
        throw new Error(`API ${response.status}`);
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed");
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (!detail) {
    return <p className="text-sm text-muted-foreground">Loading entry…</p>;
  }
  if (!detail.entry) {
    return <p className="text-sm text-muted-foreground">Journal entry not found.</p>;
  }
  const entry = detail.entry;

  return (
    <div className="space-y-4">
      <Link href="/journal" className="font-mono text-xs uppercase text-muted-foreground hover:text-foreground">
        Back to journal
      </Link>
      <section className="grid gap-3 md:grid-cols-4">
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Instrument</p>
          <p className="mt-2">{entry.symbol ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Match</p>
          <Badge className="mt-2" variant={entry.matchStatus === "UNGATED" ? "stale" : "live"}>
            {entry.matchStatus}
          </Badge>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">P/L</p>
          <p className="mt-2 font-mono text-sm">{entry.realizedPnl ?? "open"} / {entry.resultR ?? "—"}R</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-muted-foreground">MAE / MFE</p>
          <p className="mt-2 font-mono text-sm">{entry.maeUsd ?? "—"} / {entry.mfeUsd ?? "—"}</p>
        </Card>
      </section>
      <Card>
        <p className="text-xs uppercase text-muted-foreground">eToro facts</p>
        <p className="mt-2 font-mono text-xs">
          {entry.direction} · open {entry.openPrice ?? "—"} · close {entry.closePrice ?? "—"} · units {entry.units ?? "—"}
        </p>
      </Card>
      {detail.signal ? (
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Signal evidence</p>
          <p className="mt-2 text-sm">
            {detail.signal.strategyKey} {detail.signal.direction} · {detail.signal.state} · score {detail.signal.score}
          </p>
        </Card>
      ) : null}
      {detail.plan ? (
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Plan</p>
          <p className="mt-2 font-mono text-xs">
            risk {detail.plan.riskAmountUsd ?? "—"} · expected {detail.plan.expectedR ?? "—"}R · stop {detail.plan.stopLoss ?? "—"}
          </p>
        </Card>
      ) : null}
      {entry.matchStatus === "UNMATCHED" || entry.matchStatus === "UNGATED" ? (
        <Card>
          <p className="text-xs uppercase text-muted-foreground">Link a plan</p>
          {detail.linkablePlans.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No unused approved plans for this market and direction.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {detail.linkablePlans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  className="block font-mono text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => void save({ body: { tradePlanId: plan.id, followedPlan: true } })}
                >
                  {plan.approvedAt} · {plan.symbol} · {plan.expectedR ?? "—"}R
                </button>
              ))}
            </div>
          )}
        </Card>
      ) : null}
      <Card>
        <p className="text-xs uppercase text-muted-foreground">Notes and emotion</p>
        <textarea
          className="mt-2 w-full rounded-md border border-border bg-background p-2 text-sm"
          rows={4}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        <input
          className="mt-2 w-full rounded-md border border-border bg-background p-2 text-sm"
          placeholder="Post-trade emotion"
          value={emotion}
          onChange={(event) => setEmotion(event.target.value)}
        />
        <button
          type="button"
          className="mt-3 font-mono text-xs uppercase text-muted-foreground hover:text-foreground"
          disabled={saving}
          onClick={() => void save({ body: { notes, postTradeEmotion: emotion } })}
        >
          Save notes
        </button>
      </Card>
      <Card>
        <p className="text-xs uppercase text-muted-foreground">Screenshot</p>
        {entry.screenshotUrl ? (
          <img
            src={`${API_BASE_URL}${entry.screenshotUrl}`}
            alt="Trade screenshot"
            className="mt-2 max-h-64 rounded-md border border-border"
          />
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No screenshot yet.</p>
        )}
        <input
          className="mt-3 block text-sm"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void uploadScreenshot({ file });
            }
          }}
        />
      </Card>
    </div>
  );
}
