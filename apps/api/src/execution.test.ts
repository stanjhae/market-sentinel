import { describe, expect, it } from "vitest";
import {
  classifyLookupStatus,
  DemoExecutionIsolationError,
  findOpenInPnl,
  type DemoOrderLookup,
  type EtoroPnlResponse,
} from "@market-sentinel/etoro-client";
import {
  amountsBoundToPlan,
  canMintNewExecution,
  executionStatusFromEnv,
  isUniqueViolation,
  reconcileCloseOrder,
  reconcileOpenOrder,
  shouldPostOnConfirm,
} from "./execution.js";
import { SESSION_COOKIE_NAME, signSession } from "./auth.js";
import { buildServer } from "./server.js";
import { parseEnv } from "@market-sentinel/config";

const infra = {
  DATABASE_URL: "postgres://sentinel:sentinel@localhost:5432/market_sentinel",
  REDIS_URL: "redis://localhost:6379",
};

const appPassword = "correct-horse";

function sessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=${signSession({ secret: appPassword, now: Date.now() })}`;
}

describe("execution isolation status", () => {
  it("is closed when the account is Real, the flag is unset, or APP_PASSWORD is missing", () => {
    const real = executionStatusFromEnv({
      env: parseEnv({ ...infra, ETORO_ACCOUNT_TYPE: "real", DEMO_EXECUTION_ENABLED: "true", APP_PASSWORD: appPassword }),
    });
    expect(real.allowed).toBe(false);
    expect(real.blockReasons).toContain("account-type-not-demo");
    const disabled = executionStatusFromEnv({
      env: parseEnv({ ...infra, ETORO_ACCOUNT_TYPE: "demo", APP_PASSWORD: appPassword }),
    });
    expect(disabled.allowed).toBe(false);
    expect(disabled.blockReasons).toContain("demo-execution-disabled");
    const noPassword = executionStatusFromEnv({
      env: parseEnv({ ...infra, ETORO_ACCOUNT_TYPE: "demo", DEMO_EXECUTION_ENABLED: "true" }),
    });
    expect(noPassword.allowed).toBe(false);
    expect(noPassword.blockReasons).toContain("app-password-required");
    const open = executionStatusFromEnv({
      env: parseEnv({
        ...infra,
        ETORO_ACCOUNT_TYPE: "demo",
        DEMO_EXECUTION_ENABLED: "true",
        APP_PASSWORD: appPassword,
      }),
    });
    expect(open.allowed).toBe(true);
  });
});

describe("execution confirm helpers", () => {
  it("mints a new send only when there is no active order", () => {
    expect(canMintNewExecution({ existingStatus: null })).toBe(true);
    expect(canMintNewExecution({ existingStatus: "REJECTED" })).toBe(true);
    expect(canMintNewExecution({ existingStatus: "PENDING" })).toBe(false);
    expect(canMintNewExecution({ existingStatus: "FILLED" })).toBe(false);
    expect(canMintNewExecution({ existingStatus: "AMBIGUOUS" })).toBe(false);
  });

  it("posts only for a first persist or a PENDING row with no recorded response", () => {
    expect(shouldPostOnConfirm({ existing: null })).toBe(true);
    expect(shouldPostOnConfirm({ existing: { status: "PENDING", rawResponseJson: null, etoroOrderId: null } })).toBe(true);
    expect(shouldPostOnConfirm({ existing: { status: "PENDING", rawResponseJson: { kind: "ambiguous" }, etoroOrderId: null } })).toBe(
      false,
    );
    expect(shouldPostOnConfirm({ existing: { status: "AMBIGUOUS", rawResponseJson: {}, etoroOrderId: "8" } })).toBe(false);
    expect(shouldPostOnConfirm({ existing: { status: "FILLED", rawResponseJson: {}, etoroOrderId: "8" } })).toBe(false);
  });

  it("binds nonce size, stops, and instrument to the stored plan", () => {
    expect(
      amountsBoundToPlan({
        nonceAmount: "50.0",
        planAmount: "50",
        nonceStop: "12.00",
        planStop: "12",
        nonceTarget: "20",
        planTarget: "20",
        nonceInstrumentId: 27,
        planInstrumentId: 27,
      }),
    ).toBe(true);
    expect(
      amountsBoundToPlan({
        nonceAmount: "50",
        planAmount: "10",
        nonceStop: "12",
        planStop: "12",
        nonceTarget: "20",
        planTarget: "20",
        nonceInstrumentId: 27,
        planInstrumentId: 27,
      }),
    ).toBe(false);
    expect(
      amountsBoundToPlan({
        nonceAmount: "50",
        planAmount: null,
        nonceStop: "12",
        planStop: "12",
        nonceTarget: "20",
        planTarget: "20",
        nonceInstrumentId: 27,
        planInstrumentId: 27,
      }),
    ).toBe(false);
  });

  it("detects postgres unique violations through wrapped causes", () => {
    expect(isUniqueViolation({ error: { code: "23505" } })).toBe(true);
    expect(isUniqueViolation({ error: { cause: { code: "23505" } } })).toBe(true);
    expect(isUniqueViolation({ error: new Error("nope") })).toBe(false);
  });
});

describe("execution routes", () => {
  it("reports isolation and rejects preview or confirm on a Real account", async () => {
    const { app } = await buildServer({
      env: parseEnv({ ...infra, ETORO_ACCOUNT_TYPE: "real", DEMO_EXECUTION_ENABLED: "true", APP_PASSWORD: appPassword }),
    });
    const headers = { cookie: sessionCookie() };
    const status = await app.inject({ method: "GET", url: "/execution/status", headers });
    expect(status.statusCode).toBe(200);
    expect(status.json().allowed).toBe(false);
    const preview = await app.inject({ method: "POST", url: "/execution/preview", headers, payload: { planId: "plan-1" } });
    expect([403, 503]).toContain(preview.statusCode);
    const confirm = await app.inject({ method: "POST", url: "/execution/confirm", headers, payload: { nonce: "nope" } });
    expect([403, 409, 503]).toContain(confirm.statusCode);
    await app.close();
  });

  it("rejects confirm without a nonce when Demo execution is enabled", async () => {
    const { app } = await buildServer({
      env: parseEnv({
        ...infra,
        ETORO_ACCOUNT_TYPE: "demo",
        DEMO_EXECUTION_ENABLED: "true",
        APP_PASSWORD: appPassword,
        ETORO_API_KEY: "api-secret",
        ETORO_USER_KEY: "user-secret",
      }),
      executionClient: {
        ensureDemoKey: async () => "demo",
      } as never,
    });
    const headers = { cookie: sessionCookie() };
    const missing = await app.inject({ method: "POST", url: "/execution/confirm", headers, payload: {} });
    expect(missing.statusCode).toBe(409);
    const tampered = await app.inject({ method: "POST", url: "/execution/confirm", headers, payload: { nonce: "tampered" } });
    expect([409, 503]).toContain(tampered.statusCode);
    await app.close();
  });

  it("rejects Demo preview when APP_PASSWORD is unset even if the flag is on", async () => {
    const { app } = await buildServer({
      env: parseEnv({
        ...infra,
        ETORO_ACCOUNT_TYPE: "demo",
        DEMO_EXECUTION_ENABLED: "true",
        ETORO_API_KEY: "api-secret",
        ETORO_USER_KEY: "user-secret",
      }),
      executionClient: {
        ensureDemoKey: async () => "demo",
      } as never,
    });
    const status = await app.inject({ method: "GET", url: "/execution/status" });
    expect(status.json().blockReasons).toContain("app-password-required");
    const preview = await app.inject({ method: "POST", url: "/execution/preview", payload: { planId: "plan-1" } });
    expect(preview.statusCode).toBe(403);
    expect(preview.json().blockReasons).toContain("app-password-required");
    await app.close();
  });
});

describe("reconcileOpenOrder", () => {
  it("classifies a filled lookup without placing another order", async () => {
    let creates = 0;
    const client = {
      createOpenOrder: async () => {
        creates += 1;
        throw new Error("must not POST again");
      },
      lookupOrder: async (): Promise<DemoOrderLookup> => ({ orderId: 88, status: { id: 3, name: "Filled" }, positionExecutions: [{ positionId: 9 }] }),
      getDemoPnl: async (): Promise<EtoroPnlResponse> => ({ clientPortfolio: { positions: [] } }),
    };
    const result = await reconcileOpenOrder({
      client: client as never,
      requestId: "11111111-1111-4111-8111-111111111111",
      referenceId: "11111111-1111-4111-8111-111111111111",
      instrumentId: 27,
      sleep: async () => undefined,
      pnlWaitMs: 0,
    });
    expect(result.status).toBe("FILLED");
    expect(result.positionId).toBe("9");
    expect(creates).toBe(0);
    expect(classifyLookupStatus({ statusId: 3 })).toBe("FILLED");
  });

  it("uses Demo PnL only when the same orderId is present and still does not POST", async () => {
    let creates = 0;
    const client = {
      createOpenOrder: async () => {
        creates += 1;
        throw new Error("must not POST again");
      },
      lookupOrder: async () => {
        throw new DemoExecutionIsolationError("lookup missed");
      },
      getDemoPnl: async (): Promise<EtoroPnlResponse> => ({
        clientPortfolio: { positions: [{ positionID: 12, instrumentID: 27, orderID: 4 }] },
      }),
    };
    const matched = await reconcileOpenOrder({
      client: client as never,
      requestId: "11111111-1111-4111-8111-111111111111",
      referenceId: "11111111-1111-4111-8111-111111111111",
      instrumentId: 27,
      etoroOrderId: 4,
      sleep: async () => undefined,
      pnlWaitMs: 0,
    });
    expect(matched).toEqual({ status: "FILLED", etoroOrderId: "4", positionId: "12" });
    const otherPosition = await reconcileOpenOrder({
      client: client as never,
      requestId: "11111111-1111-4111-8111-111111111111",
      referenceId: "11111111-1111-4111-8111-111111111111",
      instrumentId: 27,
      etoroOrderId: 99,
      sleep: async () => undefined,
      pnlWaitMs: 0,
    });
    expect(otherPosition.status).toBe("AMBIGUOUS");
    const noOrderId = await reconcileOpenOrder({
      client: client as never,
      requestId: "11111111-1111-4111-8111-111111111111",
      referenceId: "11111111-1111-4111-8111-111111111111",
      instrumentId: 27,
      sleep: async () => undefined,
      pnlWaitMs: 0,
    });
    expect(noOrderId.status).toBe("AMBIGUOUS");
    expect(creates).toBe(0);
    expect(findOpenInPnl({ instrumentId: 27, orderId: 4, pnl: { clientPortfolio: { positions: [{ positionID: 12, instrumentID: 27, orderID: 4 }] } } }).found).toBe(
      true,
    );
  });
});

describe("reconcileCloseOrder", () => {
  it("classifies close lookup with the same status ids as open and does not treat in-flight as filled", async () => {
    const client = {
      getCloseOrder: async () => ({ orderForClose: { statusID: 2, orderID: 7 } }),
      getDemoPnl: async (): Promise<EtoroPnlResponse> => ({
        clientPortfolio: { positions: [{ positionID: 12, instrumentID: 27 }] },
      }),
    };
    const inFlight = await reconcileCloseOrder({
      client: client as never,
      positionId: "12",
      etoroOrderId: "7",
      sleep: async () => undefined,
      pnlWaitMs: 0,
    });
    expect(inFlight.status).toBe("AMBIGUOUS");
    const filledClient = {
      getCloseOrder: async () => ({ orderForClose: { statusID: 3, orderID: 7 } }),
      getDemoPnl: async () => ({ clientPortfolio: { positions: [] } }),
    };
    const filled = await reconcileCloseOrder({
      client: filledClient as never,
      positionId: "12",
      etoroOrderId: "7",
      sleep: async () => undefined,
      pnlWaitMs: 0,
    });
    expect(filled.status).toBe("FILLED");
    const rejectedClient = {
      getCloseOrder: async () => ({ orderForClose: { statusID: 4, orderID: 7 } }),
      getDemoPnl: async () => ({ clientPortfolio: { positions: [{ positionID: 12 }] } }),
    };
    const rejected = await reconcileCloseOrder({
      client: rejectedClient as never,
      positionId: "12",
      etoroOrderId: "7",
      sleep: async () => undefined,
      pnlWaitMs: 0,
    });
    expect(rejected.status).toBe("REJECTED");
  });

  it("treats a missing position after lookup failure as filled only when PnL no longer lists it", async () => {
    const gone = {
      getCloseOrder: async () => {
        throw new Error("lookup missed");
      },
      getDemoPnl: async (): Promise<EtoroPnlResponse> => ({ clientPortfolio: { positions: [] } }),
    };
    const filled = await reconcileCloseOrder({
      client: gone as never,
      positionId: "12",
      etoroOrderId: "7",
      sleep: async () => undefined,
      pnlWaitMs: 0,
    });
    expect(filled.status).toBe("FILLED");
    const stillOpen = {
      getCloseOrder: async () => {
        throw new Error("lookup missed");
      },
      getDemoPnl: async (): Promise<EtoroPnlResponse> => ({
        clientPortfolio: { positions: [{ positionID: 12, instrumentID: 27 }] },
      }),
    };
    const ambiguous = await reconcileCloseOrder({
      client: stillOpen as never,
      positionId: "12",
      etoroOrderId: "7",
      sleep: async () => undefined,
      pnlWaitMs: 0,
    });
    expect(ambiguous.status).toBe("AMBIGUOUS");
  });
});
