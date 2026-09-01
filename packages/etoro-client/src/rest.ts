import { CircuitBreaker } from "./circuit-breaker.js";
import { createRequestId } from "./request-id.js";
import { shouldRetry } from "./retry.js";
import { flattenHistoryCandles } from "./candles.js";
import { ETORO_ROUTES, instrumentCandleHistoryPath, type EtoroCandleInterval } from "./routes.js";
import type {
  AggregatedPortfolioResponse,
  EtoroCandlesResponse,
  EtoroClientConfig,
  InstrumentSearchResponse,
  LiveRatesResponse,
  NormalizedHistoryCandle,
} from "./types.js";

export type RestDeps = {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export class EtoroRestError extends Error {
  readonly status: number;
  readonly requestId: string;
  readonly body: string;

  constructor(args: { status: number; requestId: string; body: string }) {
    super(`eToro REST ${args.status} (${args.requestId})`);
    this.status = args.status;
    this.requestId = args.requestId;
    this.body = args.body;
  }
}

export class EtoroRestClient {
  private readonly breaker = new CircuitBreaker();

  constructor(
    private readonly config: EtoroClientConfig,
    private readonly deps: RestDeps = {},
  ) {}

  async ping(): Promise<{ ok: boolean; requestId: string }> {
    const result = await this.searchInstruments({
      fields: "instrumentId",
      pageSize: 1,
    });
    return { ok: true, requestId: result.requestId };
  }

  async searchInstruments(args: {
    fields: string;
    pageSize?: number;
    pageNumber?: number;
    filters?: Record<string, string | number>;
  }): Promise<{ data: InstrumentSearchResponse; requestId: string }> {
    const query: Record<string, string> = {
      fields: args.fields,
      ...(args.pageSize !== undefined ? { pageSize: String(args.pageSize) } : {}),
      ...(args.pageNumber !== undefined ? { pageNumber: String(args.pageNumber) } : {}),
    };
    for (const [key, value] of Object.entries(args.filters ?? {})) {
      query[key] = String(value);
    }
    return this.request<InstrumentSearchResponse>({
      method: "GET",
      path: ETORO_ROUTES.searchInstruments,
      query,
    });
  }

  async getInstrumentRates(args: {
    instrumentIds: number[];
  }): Promise<{ data: LiveRatesResponse; requestId: string }> {
    return this.request<LiveRatesResponse>({
      method: "GET",
      path: ETORO_ROUTES.instrumentRates,
      query: { instrumentIds: args.instrumentIds.join(",") },
    });
  }

  async getInstrumentCandles(args: {
    instrumentId: number;
    direction: "asc" | "desc";
    interval: EtoroCandleInterval;
    candlesCount: number;
  }): Promise<{
    data: EtoroCandlesResponse;
    requestId: string;
    candles: NormalizedHistoryCandle[];
  }> {
    const path = instrumentCandleHistoryPath({
      instrumentId: args.instrumentId,
      direction: args.direction,
      interval: args.interval,
      candlesCount: args.candlesCount,
    });
    const result = await this.request<EtoroCandlesResponse>({
      method: "GET",
      path,
    });
    return {
      ...result,
      candles: flattenHistoryCandles({
        data: result.data,
        fallbackInstrumentId: args.instrumentId,
      }),
    };
  }

  async getAggregatedPortfolio(): Promise<{
    data: AggregatedPortfolioResponse;
    requestId: string;
  }> {
    const path =
      this.config.accountType === "demo"
        ? ETORO_ROUTES.aggregatePortfolioDemo
        : ETORO_ROUTES.aggregatePortfolioReal;
    return this.request<AggregatedPortfolioResponse>({
      method: "GET",
      path,
    });
  }

  private async request<T>(args: {
    method: string;
    path: string;
    query?: Record<string, string>;
  }): Promise<{ data: T; requestId: string }> {
    const fetchImpl = this.deps.fetch ?? fetch;
    const now = this.deps.now ?? Date.now;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const maxAttempts = this.config.maxRetries ?? 3;

    if (!this.breaker.allow(now())) {
      throw new Error("eToro REST circuit breaker is open");
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const requestId = createRequestId();
      const url = new URL(args.path, this.config.restBaseUrl);
      for (const [key, value] of Object.entries(args.query ?? {})) {
        url.searchParams.set(key, value);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 10_000);

      try {
        const response = await fetchImpl(url, {
          method: args.method,
          headers: {
            "x-api-key": this.config.apiKey,
            "x-user-key": this.config.userKey,
            "x-request-id": requestId,
            accept: "application/json",
          },
          signal: controller.signal,
        });
        const body = await response.text();

        if (response.status === 429) {
          const retryAfter = Number(response.headers.get("retry-after") ?? "1");
          if (shouldRetry({ method: args.method, status: 429, attempt, maxAttempts })) {
            await sleep(Math.max(1, retryAfter) * 1000);
            continue;
          }
        }

        if (!response.ok) {
          if (shouldRetry({ method: args.method, status: response.status, attempt, maxAttempts })) {
            this.breaker.recordFailure(now());
            lastError = new EtoroRestError({ status: response.status, requestId, body });
            continue;
          }
          this.breaker.recordFailure(now());
          throw new EtoroRestError({ status: response.status, requestId, body });
        }

        this.breaker.recordSuccess();
        return { data: body ? (JSON.parse(body) as T) : ({} as T), requestId };
      } catch (error) {
        lastError = error;
        const status = error instanceof EtoroRestError ? error.status : undefined;
        if (!shouldRetry({ method: args.method, status, attempt, maxAttempts })) {
          this.breaker.recordFailure(now());
          throw error;
        }
        this.breaker.recordFailure(now());
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("eToro REST request failed");
  }
}
