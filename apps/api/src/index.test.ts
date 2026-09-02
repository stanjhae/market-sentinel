import { describe, expect, it } from "vitest";
import { disconnectedMarkets } from "./markets.js";
import { buildServer } from "./server.js";

describe("api health and markets", () => {
  it("reports live status", async () => {
    const { app } = await buildServer();
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("returns the watchlist even when redis is unavailable", async () => {
    const { app } = await buildServer();
    const response = await app.inject({ method: "GET", url: "/markets" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.markets).toHaveLength(4);
    expect(body.markets.map((item: { symbol: string }) => item.symbol).sort()).toEqual(
      disconnectedMarkets().markets.map((item) => item.symbol).sort(),
    );
    if (body.etoroConnected === false && body.markets.every((item: { lastQuoteAt: string | null }) => item.lastQuoteAt === null)) {
      expect(body.markets.every((item: { freshness: string }) => item.freshness === "DISCONNECTED")).toBe(true);
    }
    await app.close();
  });

  it("rejects unknown timeframes and non-ISO candle ranges", async () => {
    const { app } = await buildServer();
    const timeframe = await app.inject({ method: "GET", url: "/markets/US30/candles?timeframe=1d" });
    expect(timeframe.statusCode).toBe(400);
    const range = await app.inject({ method: "GET", url: "/markets/US30/candles?from=yesterday" });
    expect(range.statusCode).toBe(400);
    await app.close();
  });

  it("allows browser PATCH and DELETE on CORS preflight", async () => {
    const { app } = await buildServer();
    const response = await app.inject({
      method: "OPTIONS",
      url: "/settings/alerts",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "content-type",
      },
    });
    expect(response.statusCode).toBe(204);
    expect(String(response.headers["access-control-allow-methods"])).toMatch(/PATCH/);
    expect(String(response.headers["access-control-allow-methods"])).toMatch(/DELETE/);
    await app.close();
  });

  it("returns an empty alerts inbox and settings without Telegram secrets", async () => {
    const { app } = await buildServer();
    const alerts = await app.inject({ method: "GET", url: "/alerts" });
    expect(alerts.statusCode).toBe(200);
    const alertsBody = alerts.json();
    expect(typeof alertsBody.unreadCount).toBe("number");
    expect(alertsBody.unreadCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(alertsBody.alerts)).toBe(true);
    expect(alertsBody.alerts.length).toBeLessThanOrEqual(100);
    const settings = await app.inject({ method: "GET", url: "/settings" });
    expect(settings.statusCode).toBe(200);
    const settingsBody = settings.json();
    expect(settingsBody.telegramConfigured).toBe(false);
    expect(JSON.stringify(settingsBody)).not.toContain("TELEGRAM_BOT_TOKEN");
    expect(JSON.stringify(settingsBody)).not.toContain("bot");
    await app.close();
  });

  it("refuses an invalid evaluate-plan body and accepts empty events", async () => {
    const { app } = await buildServer();
    const invalid = await app.inject({
      method: "POST",
      url: "/risk/evaluate-plan",
      payload: { symbol: "BTC", direction: "LONG" },
    });
    expect([400, 503]).toContain(invalid.statusCode);
    const events = await app.inject({ method: "GET", url: "/events" });
    expect([200, 503]).toContain(events.statusCode);
    if (events.statusCode === 200) {
      expect(Array.isArray(events.json().events)).toBe(true);
    }
    const settings = await app.inject({ method: "GET", url: "/settings" });
    if (settings.statusCode === 200) {
      expect(settings.json().risk.maxRiskPerTradePct).toBe(1);
    }
    await app.close();
  });

  it("accepts watchlist symbols case-insensitively", async () => {
    const { app } = await buildServer();
    const response = await app.inject({ method: "GET", url: "/markets/us30/candles?timeframe=1h" });
    expect(response.statusCode).toBe(200);
    expect(response.json().symbol).toBe("US30");
    await app.close();
  });

  it("refuses create-plan on an unknown signal even with a forged checklist", async () => {
    const { app } = await buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/signals/00000000-0000-4000-8000-000000000000/create-plan",
      payload: {
        checklist: {
          definedEntry: true,
          definedStop: true,
          minimumRr: true,
          notRecovering: true,
          notChasing: true,
          knowHtf: true,
          noBlackoutImminent: true,
          wouldStillTake: true,
        },
        riskPct: "5",
      },
    });
    expect([404, 503]).toContain(response.statusCode);
    await app.close();
  });

  it("returns empty journal and analytics envelopes without inventing a track record", async () => {
    const { app } = await buildServer();
    const journal = await app.inject({ method: "GET", url: "/journal" });
    expect(journal.statusCode).toBe(200);
    const journalBody = journal.json();
    expect(Array.isArray(journalBody.entries)).toBe(true);
    const analytics = await app.inject({ method: "GET", url: "/analytics/summary" });
    expect(analytics.statusCode).toBe(200);
    const analyticsBody = analytics.json();
    expect(analyticsBody.empty === true || analyticsBody.summary === null || typeof analyticsBody.summary?.closedCount === "number").toBe(true);
    if (analyticsBody.empty) {
      expect(analyticsBody.summary).toBeNull();
    }
    const unknown = await app.inject({
      method: "PATCH",
      url: "/journal/missing",
      payload: { notes: "x" },
    });
    expect([404, 503]).toContain(unknown.statusCode);
    const traversal = await app.inject({ method: "GET", url: "/journal/../package.json/screenshot" });
    expect(traversal.statusCode).toBe(404);
    const badId = await app.inject({ method: "GET", url: "/journal/not-a-uuid/screenshot" });
    expect(badId.statusCode).toBe(404);
    const backtest = await app.inject({
      method: "POST",
      url: "/backtests",
      payload: { symbol: "US30" },
    });
    expect([200, 503]).toContain(backtest.statusCode);
    if (backtest.statusCode === 200) {
      const body = backtest.json();
      expect(body.run === null || body.run.emptyReason === "no-final-candles" || typeof body.run.barCount === "number").toBe(true);
    }
    const replay = await app.inject({
      method: "POST",
      url: "/replay/sessions",
      payload: { symbol: "BTC" },
    });
    expect(replay.statusCode).toBe(400);
    const missingPlan = await app.inject({
      method: "PATCH",
      url: "/journal/00000000-0000-4000-8000-000000000000",
      payload: { tradePlanId: "11111111-1111-4111-8111-111111111111" },
    });
    expect([400, 404, 503]).toContain(missingPlan.statusCode);
    await app.close();
  });
});
