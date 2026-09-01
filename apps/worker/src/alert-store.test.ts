import { describe, expect, it } from "vitest";
import { sendTelegramAlert, telegramMessage } from "./alert-store.js";
import { shouldAlertStreamStale, shouldEmitAlert, shouldPublishStreamStatus } from "@market-sentinel/domain";

describe("telegram delivery", () => {
  it("skips when credentials are missing and never embeds a token in the message", () => {
    const text = telegramMessage({
      title: "US30 — SHORT WATCH — 84/100",
      body: "4H bearish correction.",
    });
    expect(text).toContain("US30");
    expect(text).not.toMatch(/bot[0-9]/i);
    expect(text).not.toContain("TELEGRAM_BOT_TOKEN");
  });

  it("does not call Telegram when token or chat id is empty", async () => {
    expect(await sendTelegramAlert({ telegram: {}, title: "t", body: "b" })).toBe("skipped");
    expect(await sendTelegramAlert({ telegram: { botToken: "tok" }, title: "t", body: "b" })).toBe("skipped");
    expect(await sendTelegramAlert({ telegram: { chatId: "1" }, title: "t", body: "b" })).toBe("skipped");
  });
});

describe("stream event gating", () => {
  it("does not publish a stream frame for an unchanged LIVE tick", () => {
    expect(shouldPublishStreamStatus({ previousStatus: "LIVE", nextStatus: "LIVE" })).toBe(false);
    expect(shouldPublishStreamStatus({ previousStatus: "LIVE", nextStatus: "STALE" })).toBe(true);
  });

  it("does not re-emit STREAM_STALE when the Redis episode is already active", () => {
    expect(shouldAlertStreamStale({ episodeActive: true, nextStatus: "STALE" }).emit).toBe(false);
    expect(shouldAlertStreamStale({ episodeActive: false, nextStatus: "STALE" }).emit).toBe(true);
  });
});

describe("historical mute", () => {
  it("never emits on backfill even for a mapped type", () => {
    expect(shouldEmitAlert({ streamGate: "historical", type: "PRICE_ZONE_BROKEN" })).toBe(false);
    expect(shouldEmitAlert({ streamGate: "historical", type: "WATCHLIST_OPPORTUNITY" })).toBe(false);
    expect(shouldEmitAlert({ streamGate: "live", type: "PRICE_ZONE_BROKEN" })).toBe(true);
  });
});
