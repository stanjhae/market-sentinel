import { describe, expect, it } from "vitest";
import { emptyAlerts, parseStreamSnapshot, toAlertDto } from "./alerts.js";
import { emptySettings, parseJsonBucketPatch } from "./settings.js";

describe("alerts api helpers", () => {
  it("returns an explicit empty inbox", () => {
    expect(emptyAlerts()).toEqual({ available: false, staleStream: false, unreadCount: 0, alerts: [] });
  });

  it("maps a stored alert without leaking credentials", () => {
    const dto = toAlertDto({
      row: {
        id: "a1",
        type: "WATCHLIST_OPPORTUNITY",
        instrumentId: "inst-1",
        symbol: "US30",
        signalId: "sig-1",
        zoneId: null,
        title: "US30 — SHORT WATCH — 84/100",
        body: "4H bearish correction.",
        score: 84,
        direction: "SHORT",
        state: "DETECTED",
        dedupeKey: "WATCHLIST_OPPORTUNITY:inst-1:sig-1:DETECTED",
        channelsJson: ["in_app", "browser"],
        readAt: null,
        createdAt: new Date("2026-09-02T00:00:00.000Z"),
      },
    });
    expect(dto.title).toContain("US30");
    expect(JSON.stringify(dto)).not.toContain("TELEGRAM");
    expect(JSON.stringify(dto)).not.toContain("token");
  });
});

describe("stream snapshot parse", () => {
  it("does not treat invalid JSON as stale and still allows the inbox to load", () => {
    expect(parseStreamSnapshot({ raw: "{not-json" })).toEqual({
      streamStatus: "DISCONNECTED",
      lastQuoteAt: null,
      stale: false,
    });
    expect(parseStreamSnapshot({ raw: null }).stale).toBe(true);
    expect(parseStreamSnapshot({ raw: JSON.stringify({ streamStatus: "LIVE", lastQuoteAt: "t" }) }).stale).toBe(false);
  });
});

describe("settings helpers", () => {
  it("exposes telegramConfigured without a token", () => {
    const empty = emptySettings({ telegramConfigured: false });
    expect(empty.telegramConfigured).toBe(false);
    expect(empty.alerts.enabled).toBe(true);
    expect(JSON.stringify(empty)).not.toContain("bot");
  });

  it("rejects prototype keys and oversized settings buckets", () => {
    expect(parseJsonBucketPatch({ patch: { constructor: { name: "x" } } }).ok).toBe(false);
    expect(parseJsonBucketPatch({ patch: { dailyLoss: 2 } }).ok).toBe(true);
    const oversized: Record<string, unknown> = {};
    for (let index = 0; index < 33; index += 1) {
      oversized[`k${index}`] = index;
    }
    expect(parseJsonBucketPatch({ patch: oversized }).ok).toBe(false);
  });
});
