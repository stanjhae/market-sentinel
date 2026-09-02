"use client";

import type { EventsResponse, RiskProfileDto, SettingsResponse } from "@market-sentinel/contracts";
import { parseEventTimeUtc } from "@market-sentinel/domain";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useEffect, useState } from "react";

export function RiskSettingsForm() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [events, setEvents] = useState<EventsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [eventName, setEventName] = useState("");
  const [scheduledAtUtc, setScheduledAtUtc] = useState("");

  useEffect(() => {
    void Promise.all([apiFetch({ path: "/settings" }), apiFetch({ path: "/events" })])
      .then(async ([settingsResponse, eventsResponse]) => {
        if (settingsResponse.ok) setSettings((await settingsResponse.json()) as SettingsResponse);
        if (eventsResponse.ok) setEvents((await eventsResponse.json()) as EventsResponse);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "API unavailable"));
  }, []);

  async function saveRisk(args: { patch: Partial<RiskProfileDto> }) {
    const response = await apiFetch({
      path: "/settings/risk",
      init: {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args.patch),
      },
    });
    if (!response.ok) {
      setError(`API ${response.status}`);
      return;
    }
    setSettings((await response.json()) as SettingsResponse);
    setSaved(true);
  }

  async function addEvent() {
    const scheduled = parseEventTimeUtc({ value: scheduledAtUtc });
    if (!scheduled) {
      setError("Enter the event time in UTC");
      return;
    }
    const response = await apiFetch({
      path: "/events",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventName,
          currency: "USD",
          impact: "HIGH",
          scheduledAtUtc: scheduled.toISOString(),
        }),
      },
    });
    if (response.ok) {
      setEvents((await response.json()) as EventsResponse);
      setEventName("");
    }
  }

  async function removeEvent(args: { id: string }) {
    const response = await apiFetch({ path: `/events/${args.id}`, init: { method: "DELETE" } });
    if (response.ok) {
      setEvents((await response.json()) as EventsResponse);
    }
  }

  const risk = settings?.risk;
  if (!risk) {
    return <Card><p className="text-sm text-muted-foreground">{error ?? "Loading risk settings…"}</p></Card>;
  }

  return (
    <div className="space-y-4">
      {events?.newsBlackout ? <Badge variant="stale">NEWS BLACKOUT ACTIVE</Badge> : null}
      <Card>
        <p className="text-sm font-semibold">Risk profile</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 font-mono text-xs">
          {(
            [
              ["maxRiskPerTradePct", risk.maxRiskPerTradePct],
              ["maxDailyLossPct", risk.maxDailyLossPct],
              ["maxConsecutiveLosses", risk.maxConsecutiveLosses],
              ["cooldownAfterLossMinutes", risk.cooldownAfterLossMinutes],
              ["minimumRewardRisk", risk.minimumRewardRisk],
              ["maxConcurrentCorrelatedPositions", risk.maxConcurrentCorrelatedPositions],
            ] as const
          ).map(([key, value]) => (
            <label key={key}>
              <p className="text-muted-foreground">{key}</p>
              <input
                className="mt-1 w-full rounded-sm border border-border bg-background px-2 py-1"
                type="number"
                value={value}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setSettings((current) => current ? { ...current, risk: { ...current.risk, [key]: next } } : current);
                }}
              />
            </label>
          ))}
        </div>
        <button type="button" className="mt-3 font-mono text-xs uppercase" onClick={() => void saveRisk({ patch: risk })}>
          Save risk
        </button>
        {saved ? <p className="mt-2 font-mono text-xs text-live">Saved</p> : null}
      </Card>
      <Card>
        <p className="text-sm font-semibold">Manual high-impact events</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className="rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs"
            placeholder="CPI"
            value={eventName}
            onChange={(event) => setEventName(event.target.value)}
          />
          <input
            className="rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs"
            type="datetime-local"
            aria-label="Scheduled at UTC"
            value={scheduledAtUtc}
            onChange={(event) => setScheduledAtUtc(event.target.value)}
          />
          <p className="font-mono text-xs text-muted-foreground">UTC</p>
          <button type="button" className="font-mono text-xs uppercase" onClick={() => void addEvent()}>
            Add event
          </button>
        </div>
        <div className="mt-3 space-y-2 font-mono text-xs">
          {(events?.events ?? []).map((item) => (
            <div key={item.id} className="flex items-center justify-between">
              <p>
                {item.eventName} {item.currency} {item.scheduledAtUtc}
              </p>
              <button type="button" className="text-destructive" onClick={() => void removeEvent({ id: item.id })}>
                Delete
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
