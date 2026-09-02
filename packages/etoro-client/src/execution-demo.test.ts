import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertDemoExecutionAllowed,
  assertDemoExecutionPath,
  buildDemoOpenBody,
  classifyKeyProbe,
  classifyLookupStatus,
  demoClosePositionPath,
  DemoExecutionIsolationError,
  ETORO_DEMO_ROUTES,
  EtoroDemoExecutionClient,
  findOpenInPnl,
  findPositionInPnl,
} from "./execution-demo.js";
import { ETORO_ROUTES } from "./routes.js";
import type { EtoroClientConfig } from "./types.js";

const config: EtoroClientConfig = {
  apiKey: "api-secret",
  userKey: "user-secret",
  accountType: "demo",
  restBaseUrl: "https://public-api.etoro.com",
  wsUrl: "wss://ws.etoro.com/ws",
  maxRetries: 3,
};

function demoClient(args: { fetch: typeof fetch; sleep?: (ms: number) => Promise<void> }) {
  return new EtoroDemoExecutionClient(config, { fetch: args.fetch, sleep: args.sleep ?? (async () => undefined) });
}

describe("demo execution isolation", () => {
  it("refuses Real account type, a disabled flag, or a missing app password when required", () => {
    expect(() => assertDemoExecutionAllowed({ accountType: "real", enabled: true })).toThrow(DemoExecutionIsolationError);
    expect(() => assertDemoExecutionAllowed({ accountType: "demo", enabled: false })).toThrow(DemoExecutionIsolationError);
    expect(() => assertDemoExecutionAllowed({ accountType: "demo", enabled: true })).not.toThrow();
    expect(() => assertDemoExecutionAllowed({ accountType: "demo", enabled: true, appPassword: undefined })).toThrow(
      DemoExecutionIsolationError,
    );
    expect(() => assertDemoExecutionAllowed({ accountType: "demo", enabled: true, appPassword: "correct-horse" })).not.toThrow();
  });

  it("rejects non-demo execution paths", () => {
    expect(() => assertDemoExecutionPath({ path: "/api/v2/trading/execution/orders" })).toThrow(DemoExecutionIsolationError);
    expect(() => assertDemoExecutionPath({ path: "/api/v1/trading/execution/real/orders" })).toThrow(
      DemoExecutionIsolationError,
    );
    expect(() => assertDemoExecutionPath({ path: ETORO_DEMO_ROUTES.createOrder })).not.toThrow();
    expect(demoClosePositionPath({ positionId: "42" })).toBe(`${ETORO_DEMO_ROUTES.closePositionPrefix}/42`);
    expect(() => demoClosePositionPath({ positionId: "../real" })).toThrow(DemoExecutionIsolationError);
  });

  it("does not contain Real execution path literals", () => {
    const source = readFileSync(fileURLToPath(new URL("./execution-demo.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/\/trading\/execution\/real\//);
    expect(source).not.toMatch(/\/trading\/execution\/orders"/);
    expect(source).not.toMatch(/market-open-orders\/by-amount/);
    expect(source).toContain(ETORO_DEMO_ROUTES.createOrder);
    expect(source).toContain("/demo/");
  });

  it("classifies the Real PnL probe", () => {
    expect(classifyKeyProbe({ status: 200, body: "{}" })).toBe("real");
    expect(classifyKeyProbe({ status: 403, body: JSON.stringify({ error: "InsufficientPermissions" }) })).toBe("demo");
    expect(classifyKeyProbe({ status: 401, body: "nope" })).toBe("unknown");
  });

  it("classifies lookup status ids from the Demo docs", () => {
    expect(classifyLookupStatus({ statusId: 3 })).toBe("FILLED");
    expect(classifyLookupStatus({ statusId: 5 })).toBe("FILLED");
    expect(classifyLookupStatus({ statusId: 4 })).toBe("REJECTED");
    expect(classifyLookupStatus({ statusId: 2 })).toBe("IN_FLIGHT");
    expect(classifyLookupStatus({})).toBe("UNKNOWN");
  });

  it("finds an open from Demo PnL only when orderId matches", () => {
    expect(
      findOpenInPnl({
        instrumentId: 27,
        orderId: 11,
        pnl: { clientPortfolio: { positions: [{ positionID: 9, instrumentID: 27, orderID: 11 }] } },
      }),
    ).toEqual({ found: true, positionId: 9, orderId: 11 });
    expect(
      findOpenInPnl({
        instrumentId: 27,
        orderId: 4,
        pnl: { clientPortfolio: { ordersForOpen: [{ orderID: 4, instrumentID: 27 }] } },
      }),
    ).toEqual({ found: true, orderId: 4 });
    expect(
      findOpenInPnl({
        instrumentId: 27,
        pnl: { clientPortfolio: { positions: [{ positionID: 9, instrumentID: 27, orderID: 11 }] } },
      }).found,
    ).toBe(false);
    expect(
      findOpenInPnl({
        instrumentId: 27,
        orderId: 99,
        pnl: { clientPortfolio: { positions: [{ positionID: 9, instrumentID: 27, orderID: 11 }] } },
      }).found,
    ).toBe(false);
    expect(
      findPositionInPnl({ positionId: "9", pnl: { clientPortfolio: { positions: [{ positionID: 9, instrumentID: 27 }] } } }),
    ).toBe(true);
    expect(findPositionInPnl({ positionId: "9", pnl: { clientPortfolio: { positions: [] } } })).toBe(false);
  });

  it("builds a leverage-1 market open with instrumentId only", () => {
    const body = buildDemoOpenBody({ direction: "SHORT", instrumentId: 27, amount: 100, stopLossRate: 12 });
    expect(body).toEqual({
      action: "open",
      transaction: "sellShort",
      instrumentId: 27,
      orderType: "mkt",
      leverage: 1,
      amount: 100,
      orderCurrency: "usd",
      stopLossRate: 12,
    });
    expect(body).not.toHaveProperty("symbol");
  });
});

describe("EtoroDemoExecutionClient", () => {
  it("refuses create when the client account type is real or the flag is off", async () => {
    const realClient = new EtoroDemoExecutionClient(
      { ...config, accountType: "real" },
      { fetch: async () => new Response("{}", { status: 200 }) },
    );
    await expect(
      realClient.createOpenOrder({
        requestId: "11111111-1111-4111-8111-111111111111",
        body: buildDemoOpenBody({ direction: "LONG", instrumentId: 27, amount: 50 }),
      }),
    ).rejects.toBeInstanceOf(DemoExecutionIsolationError);
    const disabled = new EtoroDemoExecutionClient(config, {
      enabled: false,
      fetch: async () => new Response("{}", { status: 200 }),
    });
    await expect(
      disabled.createOpenOrder({
        requestId: "11111111-1111-4111-8111-111111111111",
        body: buildDemoOpenBody({ direction: "LONG", instrumentId: 27, amount: 50 }),
      }),
    ).rejects.toBeInstanceOf(DemoExecutionIsolationError);
  });

  it("refuses create when the Real PnL probe returns 200", async () => {
    const urls: string[] = [];
    const client = demoClient({
      fetch: async (input) => {
        urls.push(String(input));
        return new Response("{}", { status: 200 });
      },
    });
    await expect(
      client.createOpenOrder({
        requestId: "11111111-1111-4111-8111-111111111111",
        body: buildDemoOpenBody({ direction: "LONG", instrumentId: 27, amount: 50 }),
      }),
    ).rejects.toBeInstanceOf(DemoExecutionIsolationError);
    expect(urls[0]).toContain(ETORO_ROUTES.pnlReal);
    expect(urls.some((url) => url.includes("/execution/"))).toBe(false);
  });

  it("POSTs the Demo create path after a Demo key probe and looks up by referenceId", async () => {
    const seen: Array<{ url: string; requestId: string | null; method: string | undefined }> = [];
    const requestId = "22222222-2222-4222-8222-222222222222";
    const client = demoClient({
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        seen.push({ url: String(input), requestId: headers.get("x-request-id"), method: init?.method });
        if (String(input).includes(ETORO_ROUTES.pnlReal)) {
          return new Response(JSON.stringify({ error: "InsufficientPermissions" }), { status: 403 });
        }
        if (String(input).includes(ETORO_DEMO_ROUTES.createOrder)) {
          expect(headers.get("authorization")).toBeNull();
          return new Response(JSON.stringify({ orderId: 88, referenceId: requestId }), { status: 200 });
        }
        if (String(input).includes(ETORO_DEMO_ROUTES.lookupOrder)) {
          expect(String(input)).toContain(`referenceId=${requestId}`);
          return new Response(JSON.stringify({ orderId: 88, status: { id: 3, name: "Filled" } }), { status: 200 });
        }
        return new Response("nope", { status: 404 });
      },
    });
    const created = await client.createOpenOrder({
      requestId,
      body: buildDemoOpenBody({ direction: "LONG", instrumentId: 27, amount: 50 }),
    });
    expect(created.kind).toBe("accepted");
    expect(created.data?.orderId).toBe(88);
    const lookup = await client.lookupOrder({ requestId: createLookupId(), referenceId: requestId });
    expect(lookup.status?.id).toBe(3);
    expect(seen.some((item) => item.url.includes(ETORO_DEMO_ROUTES.createOrder))).toBe(true);
    expect(seen.some((item) => /\/trading\/execution\/(?!demo\/)/.test(item.url))).toBe(false);
  });

  it("does not retry a 400 execution POST", async () => {
    let posts = 0;
    const client = demoClient({
      fetch: async (input) => {
        if (String(input).includes(ETORO_ROUTES.pnlReal)) {
          return new Response(JSON.stringify({ error: "InsufficientPermissions" }), { status: 403 });
        }
        posts += 1;
        return new Response("bad", { status: 400 });
      },
    });
    const result = await client.createOpenOrder({
      requestId: "33333333-3333-4333-8333-333333333333",
      body: buildDemoOpenBody({ direction: "LONG", instrumentId: 27, amount: 50 }),
    });
    expect(result.kind).toBe("rejected");
    expect(posts).toBe(1);
  });

  it("retries 429 with the same x-request-id and does not POST again after timeout", async () => {
    const requestIds: string[] = [];
    let calls = 0;
    const client = demoClient({
      fetch: async (input, init) => {
        if (String(input).includes(ETORO_ROUTES.pnlReal)) {
          return new Response(JSON.stringify({ error: "InsufficientPermissions" }), { status: 403 });
        }
        calls += 1;
        requestIds.push(new Headers(init?.headers).get("x-request-id") ?? "");
        if (calls < 3) {
          return new Response("slow", { status: 429, headers: { "retry-after": "1" } });
        }
        return new Response(JSON.stringify({ orderId: 1 }), { status: 200 });
      },
    });
    const requestId = "44444444-4444-4444-8444-444444444444";
    const result = await client.createOpenOrder({
      requestId,
      body: buildDemoOpenBody({ direction: "LONG", instrumentId: 27, amount: 50 }),
    });
    expect(result.kind).toBe("accepted");
    expect(requestIds).toEqual([requestId, requestId, requestId]);
  });

  it("marks timeout as ambiguous without a second request id", async () => {
    const requestId = "55555555-5555-4555-8555-555555555555";
    const client = new EtoroDemoExecutionClient(
      { ...config, timeoutMs: 5 },
      {
        fetch: async (input) => {
          if (String(input).includes(ETORO_ROUTES.pnlReal)) {
            return new Response(JSON.stringify({ error: "InsufficientPermissions" }), { status: 403 });
          }
          await new Promise((_, reject) => {
            setTimeout(() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), 1);
          });
          return new Response("late", { status: 200 });
        },
      },
    );
    const result = await client.createOpenOrder({
      requestId,
      body: buildDemoOpenBody({ direction: "LONG", instrumentId: 27, amount: 50 }),
    });
    expect(result.kind).toBe("ambiguous");
    expect(result.requestId).toBe(requestId);
  });

  it("marks 5xx execution as ambiguous and does not retry", async () => {
    let posts = 0;
    const client = demoClient({
      fetch: async (input) => {
        if (String(input).includes(ETORO_ROUTES.pnlReal)) {
          return new Response(JSON.stringify({ error: "InsufficientPermissions" }), { status: 403 });
        }
        posts += 1;
        return new Response("oops", { status: 503 });
      },
    });
    const result = await client.createOpenOrder({
      requestId: "66666666-6666-4666-8666-666666666666",
      body: buildDemoOpenBody({ direction: "LONG", instrumentId: 27, amount: 50 }),
    });
    expect(result.kind).toBe("ambiguous");
    expect(posts).toBe(1);
  });
});

function createLookupId(): string {
  return "77777777-7777-4777-8777-777777777777";
}
