import { describe, expect, it } from "vitest";
import { ETORO_ROUTES } from "./routes.js";
import { EtoroRestClient, EtoroRestError } from "./rest.js";
import type { EtoroClientConfig } from "./types.js";

const config: EtoroClientConfig = {
  apiKey: "api-secret",
  userKey: "user-secret",
  accountType: "real",
  restBaseUrl: "https://public-api.etoro.com",
  wsUrl: "wss://ws.etoro.com/ws",
  maxRetries: 3,
};

describe("EtoroRestClient", () => {
  it("injects auth headers and a unique request id on GET search", async () => {
    const seen: string[] = [];
    const client = new EtoroRestClient(config, {
      fetch: async (input, init) => {
        const url = String(input);
        expect(url).toContain(ETORO_ROUTES.searchInstruments);
        const headers = new Headers(init?.headers);
        expect(headers.get("x-api-key")).toBe("api-secret");
        expect(headers.get("x-user-key")).toBe("user-secret");
        seen.push(headers.get("x-request-id") ?? "");
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      },
    });

    await client.searchInstruments({ fields: "instrumentId" });
    await client.searchInstruments({ fields: "instrumentId" });
    expect(seen[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it("retries GET rates on 500 until the attempt budget is exhausted", async () => {
    let calls = 0;
    const client = new EtoroRestClient(config, {
      fetch: async () => {
        calls += 1;
        return new Response("nope", { status: 500 });
      },
    });
    await expect(client.getInstrumentRates({ instrumentIds: [1] })).rejects.toBeInstanceOf(
      EtoroRestError,
    );
    expect(calls).toBe(3);
  });

  it("retries GET on 429 using Retry-After", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const client = new EtoroRestClient(config, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetch: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response("slow", { status: 429, headers: { "retry-after": "2" } });
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      },
    });

    await client.ping();
    expect(calls).toBe(2);
    expect(sleeps[0]).toBe(2000);
  });

  it("calls the official candle history path and flattens OHLCV", async () => {
    const client = new EtoroRestClient(config, {
      fetch: async (input) => {
        expect(String(input)).toContain(
          "/api/v1/market-data/instruments/27/history/candles/desc/FifteenMinutes/500",
        );
        return new Response(
          JSON.stringify({
            interval: "FifteenMinutes",
            candles: [
              {
                instrumentId: 27,
                candles: [
                  {
                    instrumentID: 27,
                    fromDate: "2026-09-01T12:15:00Z",
                    open: 1.2,
                    high: 1.3,
                    low: 1.1,
                    close: 1.25,
                    volume: 0,
                  },
                  {
                    instrumentID: 27,
                    fromDate: "2026-09-01T12:00:00Z",
                    open: 1.0,
                    high: 1.1,
                    low: 0.9,
                    close: 1.05,
                    volume: 0,
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      },
    });
    const result = await client.getInstrumentCandles({
      instrumentId: 27,
      direction: "desc",
      interval: "FifteenMinutes",
      candlesCount: 500,
    });
    expect(result.candles.map((item) => item.fromDate)).toEqual([
      "2026-09-01T12:00:00Z",
      "2026-09-01T12:15:00Z",
    ]);
    expect(result.candles[0]?.open).toBe("1");
  });

  it("uses the demo aggregate-portfolio path", async () => {
    const demo = new EtoroRestClient({ ...config, accountType: "demo" }, {
      fetch: async (input) => {
        expect(String(input)).toContain(ETORO_ROUTES.aggregatePortfolioDemo);
        return new Response(JSON.stringify({ accountTotals: {} }), { status: 200 });
      },
    });
    await demo.getAggregatedPortfolio();
  });

  it("uses official real PnL and demo history paths", async () => {
    const real = new EtoroRestClient(config, {
      fetch: async (input) => {
        expect(String(input)).toContain(ETORO_ROUTES.pnlReal);
        return new Response(JSON.stringify({ clientPortfolio: { credit: 1000, positions: [] } }), { status: 200 });
      },
    });
    await real.getAccountPnl();

    const demo = new EtoroRestClient({ ...config, accountType: "demo" }, {
      fetch: async (input) => {
        expect(String(input)).toContain(`${ETORO_ROUTES.tradeHistoryDemo}?minDate=2026-08-03`);
        return new Response(
          JSON.stringify({
            items: [{ positionId: 9, instrumentId: 27, netProfit: -12.5, isBuy: true }],
          }),
          { status: 200 },
        );
      },
    });
    const history = await demo.getTradeHistory({ minDate: "2026-08-03" });
    expect(history.items[0]?.positionId).toBe(9);
  });

  it("classifies demo InsufficientPermissions without treating it as a generic 401", async () => {
    const { isInsufficientPermissions } = await import("./rest.js");
    const error = new EtoroRestError({
      status: 403,
      requestId: "11111111-1111-4111-8111-111111111111",
      body: JSON.stringify({ error: "InsufficientPermissions" }),
    });
    expect(isInsufficientPermissions({ error })).toBe(true);
    expect(
      isInsufficientPermissions({
        error: new EtoroRestError({ status: 401, requestId: "x", body: "nope" }),
      }),
    ).toBe(false);
  });
});
