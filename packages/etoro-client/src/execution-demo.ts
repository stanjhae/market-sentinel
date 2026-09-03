import { createRequestId } from "./request-id.js";
import { EtoroRestError } from "./rest.js";
import { shouldRetry, shouldRetryExecutionPost } from "./retry.js";
import { ETORO_ROUTES } from "./routes.js";
import type { EtoroClientConfig, EtoroPnlOrder, EtoroPnlResponse } from "./types.js";

export const ETORO_DEMO_ROUTES = {
  costs: "/api/v2/trading/info/demo/costs",
  createOrder: "/api/v2/trading/execution/demo/orders",
  lookupOrder: "/api/v2/trading/info/demo/orders:lookup",
  closePositionPrefix: "/api/v1/trading/execution/demo/market-close-orders/positions",
  closeOrderPrefix: "/api/v1/trading/info/demo/close-orders",
  pnl: "/api/v1/trading/info/demo/pnl",
} as const;

export class DemoExecutionIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoExecutionIsolationError";
  }
}

export type ExecutionSendKind = "accepted" | "rejected" | "rate_limited_giveup" | "ambiguous";

export type ExecutionSendResult<T> = {
  kind: ExecutionSendKind;
  requestId: string;
  status?: number;
  data?: T;
  body?: string;
  retryAfterSec?: number;
};

export type DemoOpenOrderBody = {
  action: "open";
  transaction: "buy" | "sellShort";
  instrumentId: number;
  orderType: "mkt";
  leverage: 1;
  amount: number;
  orderCurrency: "usd";
  stopLossRate?: number;
  takeProfitRate?: number;
};

export type DemoCreateOrderResponse = {
  token?: string;
  orderId?: number;
  referenceId?: string;
};

export type DemoOrderLookup = {
  orderId?: number;
  referenceId?: string;
  status?: {
    id?: number;
    name?: string;
    errorCode?: number;
    errorMessage?: string | null;
  };
  positionExecutions?: Array<{ positionId?: number; state?: string }>;
};

export type DemoCostBreakdown = {
  instrumentId?: number;
  symbol?: string | null;
  costs?: Array<{ costType?: string; amount?: number; currency?: string }>;
  lastUpdated?: string;
};

export type DemoCloseOrderResponse = {
  orderForClose?: {
    positionID?: number;
    instrumentID?: number;
    orderID?: number;
    statusID?: number;
  };
  token?: string;
};

export type KeyEnvironment = "demo" | "real" | "unknown";

export type ExecutionRestDeps = {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  enabled?: boolean;
};

const LOOKUP_FILLED = new Set([3, 5]);
const LOOKUP_REJECTED = new Set([4, 10]);
const LOOKUP_IN_FLIGHT = new Set([1, 2, 11, 12]);

export function assertDemoExecutionAllowed(args: {
  accountType: string;
  enabled: boolean;
  appPassword?: string;
}): void {
  if (args.accountType !== "demo") {
    throw new DemoExecutionIsolationError("ETORO_ACCOUNT_TYPE must be demo");
  }
  if (!args.enabled) {
    throw new DemoExecutionIsolationError("DEMO_EXECUTION_ENABLED must be true");
  }
  if ("appPassword" in args && !args.appPassword) {
    throw new DemoExecutionIsolationError("APP_PASSWORD must be set to enable Demo execution");
  }
}

export function assertDemoExecutionPath(args: { path: string }): void {
  if (!args.path.includes("/demo/")) {
    throw new DemoExecutionIsolationError("path must include /demo/");
  }
  if (args.path.includes("/execution/") && !args.path.includes("/execution/demo/")) {
    throw new DemoExecutionIsolationError("execution path must be demo-scoped");
  }
}

export function demoClosePositionPath(args: { positionId: string }): string {
  if (!/^\d+$/.test(args.positionId)) {
    throw new DemoExecutionIsolationError("positionId must be numeric");
  }
  return `${ETORO_DEMO_ROUTES.closePositionPrefix}/${args.positionId}`;
}

export function demoCloseOrderPath(args: { orderId: string }): string {
  if (!/^\d+$/.test(args.orderId)) {
    throw new DemoExecutionIsolationError("orderId must be numeric");
  }
  return `${ETORO_DEMO_ROUTES.closeOrderPrefix}/${args.orderId}`;
}

export function classifyKeyProbe(args: { status: number; body: string }): KeyEnvironment {
  if (args.status === 200) {
    return "real";
  }
  if (args.status === 403 && /InsufficientPermissions/i.test(args.body)) {
    return "demo";
  }
  return "unknown";
}

export function classifyLookupStatus(args: { statusId?: number }): "FILLED" | "REJECTED" | "IN_FLIGHT" | "UNKNOWN" {
  if (args.statusId === undefined) {
    return "UNKNOWN";
  }
  if (LOOKUP_FILLED.has(args.statusId)) {
    return "FILLED";
  }
  if (LOOKUP_REJECTED.has(args.statusId)) {
    return "REJECTED";
  }
  if (LOOKUP_IN_FLIGHT.has(args.statusId)) {
    return "IN_FLIGHT";
  }
  return "UNKNOWN";
}

export function findOpenInPnl(args: {
  pnl: EtoroPnlResponse;
  instrumentId: number;
  orderId?: number;
}): {
  found: boolean;
  positionId?: number;
  orderId?: number;
} {
  if (args.orderId === undefined) {
    return { found: false };
  }
  const portfolio = args.pnl.clientPortfolio;
  const position = (portfolio?.positions ?? []).find(
    (item) => item.instrumentID === args.instrumentId && item.orderID === args.orderId,
  );
  if (position?.positionID !== undefined) {
    return { found: true, positionId: position.positionID, orderId: position.orderID };
  }
  const pending = (portfolio?.ordersForOpen ?? []).find(
    (item: EtoroPnlOrder) => item.instrumentID === args.instrumentId && item.orderID === args.orderId,
  );
  if (pending?.orderID !== undefined) {
    return { found: true, orderId: pending.orderID };
  }
  return { found: false };
}

export function findPositionInPnl(args: { pnl: EtoroPnlResponse; positionId: string }): boolean {
  return (args.pnl.clientPortfolio?.positions ?? []).some(
    (item) => item.positionID !== undefined && String(item.positionID) === args.positionId,
  );
}

export type DemoOrderReconcileClient = {
  lookupOrder: (args: { requestId: string; orderId?: number; referenceId?: string }) => Promise<DemoOrderLookup>;
  getDemoPnl: (args: { requestId: string }) => Promise<EtoroPnlResponse>;
  getCloseOrder: (args: { requestId: string; orderId: string }) => Promise<DemoCloseOrderResponse>;
};

export type DemoOrderReconcileResult = {
  status: "FILLED" | "REJECTED" | "AMBIGUOUS";
  etoroOrderId?: string;
  positionId?: string;
};

export async function reconcileOpenOrder(args: {
  client: DemoOrderReconcileClient;
  requestId: string;
  referenceId: string;
  instrumentId: number;
  etoroOrderId?: number;
  sleep?: (ms: number) => Promise<void>;
  pnlWaitMs?: number;
}): Promise<DemoOrderReconcileResult> {
  try {
    const lookup = await args.client.lookupOrder({
      requestId: createRequestId(),
      orderId: args.etoroOrderId,
      referenceId: args.etoroOrderId === undefined ? args.referenceId : undefined,
    });
    const classified = classifyLookupStatus({ statusId: lookup.status?.id });
    if (classified === "FILLED") {
      return {
        status: "FILLED",
        etoroOrderId:
          lookup.orderId !== undefined
            ? String(lookup.orderId)
            : args.etoroOrderId !== undefined
              ? String(args.etoroOrderId)
              : undefined,
        positionId:
          lookup.positionExecutions?.[0]?.positionId !== undefined
            ? String(lookup.positionExecutions[0].positionId)
            : undefined,
      };
    }
    if (classified === "REJECTED") {
      return { status: "REJECTED", etoroOrderId: lookup.orderId !== undefined ? String(lookup.orderId) : undefined };
    }
  } catch {
    // fall through to PnL
  }
  const wait = args.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  await wait(args.pnlWaitMs ?? 10_000);
  try {
    const pnl = await args.client.getDemoPnl({ requestId: createRequestId() });
    const found = findOpenInPnl({ pnl, instrumentId: args.instrumentId, orderId: args.etoroOrderId });
    if (found.found) {
      return {
        status: "FILLED",
        etoroOrderId: found.orderId !== undefined ? String(found.orderId) : undefined,
        positionId: found.positionId !== undefined ? String(found.positionId) : undefined,
      };
    }
  } catch {
    // still unknown
  }
  return { status: "AMBIGUOUS" };
}

export async function reconcileCloseOrder(args: {
  client: DemoOrderReconcileClient;
  positionId: string;
  etoroOrderId?: string | null;
  sleep?: (ms: number) => Promise<void>;
  pnlWaitMs?: number;
}): Promise<DemoOrderReconcileResult> {
  if (args.etoroOrderId) {
    try {
      const closeInfo = await args.client.getCloseOrder({ requestId: createRequestId(), orderId: args.etoroOrderId });
      const classified = classifyLookupStatus({ statusId: closeInfo.orderForClose?.statusID });
      if (classified === "FILLED") {
        return { status: "FILLED", etoroOrderId: args.etoroOrderId };
      }
      if (classified === "REJECTED") {
        return { status: "REJECTED", etoroOrderId: args.etoroOrderId };
      }
    } catch {
      // fall through to PnL
    }
  }
  const wait = args.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  await wait(args.pnlWaitMs ?? 10_000);
  try {
    const pnl = await args.client.getDemoPnl({ requestId: createRequestId() });
    if (!findPositionInPnl({ pnl, positionId: args.positionId })) {
      return { status: "FILLED", etoroOrderId: args.etoroOrderId ?? undefined };
    }
  } catch {
    // still unknown
  }
  return { status: "AMBIGUOUS", etoroOrderId: args.etoroOrderId ?? undefined };
}

export function buildDemoOpenBody(args: {
  direction: "LONG" | "SHORT";
  instrumentId: number;
  amount: number;
  stopLossRate?: number;
  takeProfitRate?: number;
}): DemoOpenOrderBody {
  const body: DemoOpenOrderBody = {
    action: "open",
    transaction: args.direction === "SHORT" ? "sellShort" : "buy",
    instrumentId: args.instrumentId,
    orderType: "mkt",
    leverage: 1,
    amount: args.amount,
    orderCurrency: "usd",
  };
  if (args.stopLossRate !== undefined) {
    body.stopLossRate = args.stopLossRate;
  }
  if (args.takeProfitRate !== undefined) {
    body.takeProfitRate = args.takeProfitRate;
  }
  return body;
}

export class EtoroDemoExecutionClient {
  private keyEnvironment: KeyEnvironment | undefined;

  constructor(
    private readonly config: EtoroClientConfig,
    private readonly deps: ExecutionRestDeps = {},
  ) {}

  async ensureDemoKey(): Promise<KeyEnvironment> {
    if (this.keyEnvironment === "demo") {
      return this.keyEnvironment;
    }
    const probe = await this.probeKeyEnvironment();
    this.keyEnvironment = probe;
    if (probe !== "demo") {
      throw new DemoExecutionIsolationError(`user-key environment is ${probe}`);
    }
    return probe;
  }

  async probeKeyEnvironment(): Promise<KeyEnvironment> {
    const fetchImpl = this.deps.fetch ?? fetch;
    const requestId = createRequestId();
    const url = new URL(ETORO_ROUTES.pnlReal, this.config.restBaseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 10_000);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: this.headers({ requestId }),
        signal: controller.signal,
      });
      const body = await response.text();
      return classifyKeyProbe({ status: response.status, body });
    } catch {
      return "unknown";
    } finally {
      clearTimeout(timeout);
    }
  }

  async getCosts(args: { requestId: string; body: DemoOpenOrderBody }): Promise<DemoCostBreakdown> {
    const result = await this.requestJson<DemoCostBreakdown>({
      method: "POST",
      path: ETORO_DEMO_ROUTES.costs,
      requestId: args.requestId,
      body: args.body,
      execution: false,
    });
    if (result.kind !== "accepted" || !result.data) {
      throw new EtoroRestError({
        status: result.status ?? 0,
        requestId: args.requestId,
        body: result.body ?? "",
      });
    }
    return result.data;
  }

  private assertClientIsolation(): void {
    assertDemoExecutionAllowed({
      accountType: this.config.accountType,
      enabled: this.deps.enabled ?? true,
    });
  }

  async createOpenOrder(args: {
    requestId: string;
    body: DemoOpenOrderBody;
  }): Promise<ExecutionSendResult<DemoCreateOrderResponse>> {
    this.assertClientIsolation();
    await this.ensureDemoKey();
    return this.requestJson<DemoCreateOrderResponse>({
      method: "POST",
      path: ETORO_DEMO_ROUTES.createOrder,
      requestId: args.requestId,
      body: args.body,
      execution: true,
    });
  }

  async lookupOrder(args: {
    requestId: string;
    orderId?: number;
    referenceId?: string;
  }): Promise<DemoOrderLookup> {
    const query: Record<string, string> = {};
    if (args.orderId !== undefined) {
      query.orderId = String(args.orderId);
    } else if (args.referenceId) {
      query.referenceId = args.referenceId;
    } else {
      throw new DemoExecutionIsolationError("lookup requires orderId or referenceId");
    }
    const result = await this.requestJson<DemoOrderLookup>({
      method: "GET",
      path: ETORO_DEMO_ROUTES.lookupOrder,
      requestId: args.requestId,
      query,
      execution: false,
    });
    if (result.kind !== "accepted" || !result.data) {
      throw new EtoroRestError({
        status: result.status ?? 0,
        requestId: args.requestId,
        body: result.body ?? "",
      });
    }
    return result.data;
  }

  async closePosition(args: {
    requestId: string;
    positionId: string;
    instrumentID: number;
  }): Promise<ExecutionSendResult<DemoCloseOrderResponse>> {
    this.assertClientIsolation();
    await this.ensureDemoKey();
    return this.requestJson<DemoCloseOrderResponse>({
      method: "POST",
      path: demoClosePositionPath({ positionId: args.positionId }),
      requestId: args.requestId,
      body: { InstrumentID: args.instrumentID, UnitsToDeduct: null },
      execution: true,
    });
  }

  async getCloseOrder(args: { requestId: string; orderId: string }): Promise<DemoCloseOrderResponse> {
    const result = await this.requestJson<DemoCloseOrderResponse>({
      method: "GET",
      path: demoCloseOrderPath({ orderId: args.orderId }),
      requestId: args.requestId,
      execution: false,
    });
    if (result.kind !== "accepted" || !result.data) {
      throw new EtoroRestError({
        status: result.status ?? 0,
        requestId: args.requestId,
        body: result.body ?? "",
      });
    }
    return result.data;
  }

  async getDemoPnl(args: { requestId: string }): Promise<EtoroPnlResponse> {
    const result = await this.requestJson<EtoroPnlResponse>({
      method: "GET",
      path: ETORO_DEMO_ROUTES.pnl,
      requestId: args.requestId,
      execution: false,
    });
    if (result.kind !== "accepted" || !result.data) {
      throw new EtoroRestError({
        status: result.status ?? 0,
        requestId: args.requestId,
        body: result.body ?? "",
      });
    }
    return result.data;
  }

  private headers(args: { requestId: string }): Record<string, string> {
    return {
      "x-api-key": this.config.apiKey,
      "x-user-key": this.config.userKey,
      "x-request-id": args.requestId,
      accept: "application/json",
      "content-type": "application/json",
    };
  }

  private async requestJson<T>(args: {
    method: "GET" | "POST";
    path: string;
    requestId: string;
    query?: Record<string, string>;
    body?: unknown;
    execution: boolean;
  }): Promise<ExecutionSendResult<T>> {
    assertDemoExecutionPath({ path: args.path });
    const fetchImpl = this.deps.fetch ?? fetch;
    const sleep = this.deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const maxAttempts = this.config.maxRetries ?? 3;
    let lastStatus: number | undefined;
    let lastBody: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const url = new URL(args.path, this.config.restBaseUrl);
      for (const [key, value] of Object.entries(args.query ?? {})) {
        url.searchParams.set(key, value);
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 10_000);
      try {
        const response = await fetchImpl(url, {
          method: args.method,
          headers: this.headers({ requestId: args.requestId }),
          body: args.method === "POST" ? JSON.stringify(args.body ?? {}) : undefined,
          signal: controller.signal,
        });
        const body = await response.text();
        lastStatus = response.status;
        lastBody = body;

        if (response.status === 429) {
          const retryAfter = Number(response.headers.get("retry-after") ?? "15");
          const canRetry = args.execution
            ? shouldRetryExecutionPost({ status: 429, attempt, maxAttempts })
            : shouldRetry({ method: args.method, status: 429, attempt, maxAttempts });
          if (canRetry) {
            await sleep(Math.max(1, retryAfter) * 1000);
            continue;
          }
          return { kind: "rate_limited_giveup", requestId: args.requestId, status: 429, body, retryAfterSec: retryAfter };
        }

        if (response.ok) {
          let data = {} as T;
          if (body) {
            try {
              data = JSON.parse(body) as T;
            } catch {
              data = {} as T;
            }
          }
          return { kind: "accepted", requestId: args.requestId, status: response.status, data, body };
        }

        if (args.execution && response.status >= 500) {
          return { kind: "ambiguous", requestId: args.requestId, status: response.status, body };
        }

        const canRetry = !args.execution && shouldRetry({ method: args.method, status: response.status, attempt, maxAttempts });
        if (canRetry) {
          continue;
        }
        return { kind: "rejected", requestId: args.requestId, status: response.status, body };
      } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        if (args.execution) {
          return { kind: "ambiguous", requestId: args.requestId, body: aborted ? "timeout" : "network" };
        }
        const canRetry = shouldRetry({ method: args.method, status: undefined, attempt, maxAttempts });
        if (!canRetry) {
          throw error;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    if (args.execution) {
      return { kind: "ambiguous", requestId: args.requestId, status: lastStatus, body: lastBody };
    }
    throw new EtoroRestError({ status: lastStatus ?? 0, requestId: args.requestId, body: lastBody ?? "" });
  }
}
