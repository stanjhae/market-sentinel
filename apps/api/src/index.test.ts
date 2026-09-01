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
    expect(body.markets.map((item: { symbol: string }) => item.symbol)).toEqual(
      disconnectedMarkets().markets.map((item) => item.symbol),
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

  it("accepts watchlist symbols case-insensitively", async () => {
    const { app } = await buildServer();
    const response = await app.inject({ method: "GET", url: "/markets/us30/candles?timeframe=1h" });
    expect(response.statusCode).toBe(200);
    expect(response.json().symbol).toBe("US30");
    await app.close();
  });
});
