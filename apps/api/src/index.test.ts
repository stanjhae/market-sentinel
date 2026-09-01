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

  it("accepts watchlist symbols case-insensitively", async () => {
    const { app } = await buildServer();
    const response = await app.inject({ method: "GET", url: "/markets/us30/candles?timeframe=1h" });
    expect(response.statusCode).toBe(200);
    expect(response.json().symbol).toBe("US30");
    await app.close();
  });
});
