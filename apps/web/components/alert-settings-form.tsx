"use client";

import type { AlertSettingsDto, SettingsResponse } from "@market-sentinel/contracts";
import { ALERT_TYPES } from "@market-sentinel/domain";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

const SYMBOLS = ["US30", "US100", "SPX500", "GOLD"] as const;

export function AlertSettingsForm() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    void apiFetch({ path: "/settings" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`API ${response.status}`);
        }
        return response.json() as Promise<SettingsResponse>;
      })
      .then((payload) => {
        setSettings(payload);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "API unavailable");
      });
  }, []);

  async function save(args: { patch: Partial<AlertSettingsDto> }) {
    try {
      const response = await apiFetch({
        path: "/settings/alerts",
        init: {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args.patch),
        },
      });
      if (!response.ok) {
        throw new Error(`API ${response.status}`);
      }
      const next = (await response.json()) as SettingsResponse;
      setSettings(next);
      setSaved(true);
      setError(null);
    } catch (cause: unknown) {
      setSaved(false);
      setError(cause instanceof Error ? cause.message : "Save failed");
    }
  }

  async function enableBrowser() {
    if (typeof Notification === "undefined") {
      return;
    }
    const next = await Notification.requestPermission();
    setPermission(next);
  }

  const alerts = settings?.alerts;

  return (
    <div className="space-y-4">
      {error ? (
        <Card>
          <p className="text-sm text-muted-foreground">{error}</p>
        </Card>
      ) : null}
      <Card>
        <p className="text-xs uppercase text-muted-foreground">Channels</p>
        <p className="mt-2 text-sm text-muted-foreground">Telegram stays server-side. The browser never receives a bot token.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Toggle
            label="Alerts enabled"
            checked={alerts?.enabled ?? true}
            onChange={(checked) => void save({ patch: { enabled: checked } })}
          />
          <Toggle
            label="Browser notifications"
            checked={alerts?.browserEnabled ?? true}
            onChange={(checked) => void save({ patch: { browserEnabled: checked } })}
          />
          <Toggle
            label="Telegram"
            checked={alerts?.telegramEnabled ?? true}
            onChange={(checked) => void save({ patch: { telegramEnabled: checked } })}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Badge variant={settings?.telegramConfigured ? "live" : "disconnected"}>
            {settings?.telegramConfigured ? "Telegram configured" : "Telegram skipped"}
          </Badge>
          <p className="font-mono text-xs text-muted-foreground">
            {settings?.telegramConfigured ? "Server Telegram credentials are present." : "Telegram skipped: no server credentials."}
          </p>
          <button type="button" className="font-mono text-xs uppercase text-muted-foreground hover:text-foreground" onClick={() => void enableBrowser()}>
            Enable browser notifications
          </button>
          <span className="font-mono text-xs text-muted-foreground">{permission}</span>
        </div>
      </Card>
      <Card>
        <p className="text-xs uppercase text-muted-foreground">Thresholds</p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <NumberField
            label="Score threshold"
            value={alerts?.scoreThreshold ?? 70}
            onCommit={(value) => void save({ patch: { scoreThreshold: value } })}
          />
          <NumberField
            label="Score delta"
            value={alerts?.scoreDelta ?? 10}
            onCommit={(value) => void save({ patch: { scoreDelta: value } })}
          />
          <NumberField
            label="Cooldown minutes"
            value={alerts?.cooldownMinutes ?? 30}
            onCommit={(value) => void save({ patch: { cooldownMinutes: value } })}
          />
        </div>
      </Card>
      <Card>
        <p className="text-xs uppercase text-muted-foreground">Mute types</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {ALERT_TYPES.map((type) => {
            const muted = alerts?.mutedTypes.includes(type) ?? false;
            return (
              <button
                key={type}
                type="button"
                className={cn("rounded-sm border border-border px-2 py-1 font-mono text-[11px] uppercase", {
                  "bg-destructive/15 text-destructive": muted,
                  "text-muted-foreground": !muted,
                })}
                onClick={() =>
                  void save({
                    patch: {
                      mutedTypes: muted ? (alerts?.mutedTypes ?? []).filter((item) => item !== type) : [...(alerts?.mutedTypes ?? []), type],
                    },
                  })
                }
              >
                {type}
              </button>
            );
          })}
        </div>
      </Card>
      <Card>
        <p className="text-xs uppercase text-muted-foreground">Mute symbols</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {SYMBOLS.map((symbol) => {
            const muted = alerts?.mutedSymbols.includes(symbol) ?? false;
            return (
              <button
                key={symbol}
                type="button"
                className={cn("rounded-sm border border-border px-2 py-1 font-mono text-xs", {
                  "bg-destructive/15 text-destructive": muted,
                  "text-muted-foreground": !muted,
                })}
                onClick={() =>
                  void save({
                    patch: {
                      mutedSymbols: muted ? (alerts?.mutedSymbols ?? []).filter((item) => item !== symbol) : [...(alerts?.mutedSymbols ?? []), symbol],
                    },
                  })
                }
              >
                {symbol}
              </button>
            );
          })}
        </div>
      </Card>
      {saved ? <p className="font-mono text-xs text-live">Saved.</p> : null}
    </div>
  );
}

function Toggle(args: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 font-mono text-xs uppercase text-muted-foreground">
      <input type="checkbox" checked={args.checked} onChange={(event) => args.onChange(event.target.checked)} />
      {args.label}
    </label>
  );
}

function NumberField(args: { label: string; value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(args.value));
  useEffect(() => {
    setDraft(String(args.value));
  }, [args.value]);
  return (
    <label className="font-mono text-xs uppercase text-muted-foreground">
      {args.label}
      <input
        className="mt-1 w-full rounded-sm border border-border bg-background px-2 py-1 text-foreground"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = Number(draft);
          if (Number.isFinite(next)) {
            args.onCommit(next);
          }
        }}
      />
    </label>
  );
}
