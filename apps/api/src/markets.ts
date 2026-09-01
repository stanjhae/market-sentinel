import type { AccountResponse, MarketsResponse } from "@market-sentinel/contracts";
import { REDIS_KEYS } from "@market-sentinel/contracts";
import { WATCHLIST } from "@market-sentinel/domain";
import { Redis } from "ioredis";

export type QuoteRecord = {
  symbol: string;
  etoroInstrumentId: number | null;
  displayName: string | null;
  resolved: boolean;
  bid: string | null;
  ask: string | null;
  last: string | null;
  dailyChangePct: string | null;
  lastQuoteAt: string | null;
};

export function disconnectedMarkets(): MarketsResponse {
  return {
    etoroConnected: false,
    streamStatus: "DISCONNECTED",
    lastQuoteAt: null,
    markets: WATCHLIST.map((symbol) => ({
      symbol,
      etoroInstrumentId: null,
      displayName: null,
      resolved: false,
      bid: null,
      ask: null,
      last: null,
      dailyChangePct: null,
      lastQuoteAt: null,
      freshness: "DISCONNECTED" as const,
    })),
  };
}

export function emptyAccount(): AccountResponse {
  return {
    available: false,
    accountType: null,
    equity: null,
    cash: null,
    availableCash: null,
    invested: null,
    unrealizedPnl: null,
    capturedAt: null,
  };
}

export async function readMarkets(redis: Redis, staleAfterMs: number): Promise<MarketsResponse> {
  const streamRaw = await redis.get(REDIS_KEYS.stream);
  const stream = streamRaw
    ? (JSON.parse(streamRaw) as { streamStatus?: MarketsResponse["streamStatus"]; lastQuoteAt?: string | null })
    : null;
  const markets = [];
  for (const symbol of WATCHLIST) {
    const raw = await redis.get(REDIS_KEYS.quote(symbol));
    const quote = raw ? (JSON.parse(raw) as QuoteRecord) : null;
    const lastQuoteAt = quote?.lastQuoteAt ?? null;
    const freshness = freshnessFrom(lastQuoteAt, stream?.streamStatus ?? "DISCONNECTED", staleAfterMs);
    markets.push({
      symbol,
      etoroInstrumentId: quote?.etoroInstrumentId ?? null,
      displayName: quote?.displayName ?? null,
      resolved: quote?.resolved ?? false,
      bid: quote?.bid ?? null,
      ask: quote?.ask ?? null,
      last: quote?.last ?? null,
      dailyChangePct: quote?.dailyChangePct ?? null,
      lastQuoteAt,
      freshness,
    });
  }
  return {
    etoroConnected: Boolean(stream && stream.streamStatus !== "DISCONNECTED"),
    streamStatus: stream?.streamStatus ?? "DISCONNECTED",
    lastQuoteAt: stream?.lastQuoteAt ?? null,
    markets,
  };
}

export async function readAccount(redis: Redis): Promise<AccountResponse> {
  const raw = await redis.get(REDIS_KEYS.account);
  if (!raw) {
    return emptyAccount();
  }
  return JSON.parse(raw) as AccountResponse;
}

function freshnessFrom(
  lastQuoteAt: string | null,
  streamStatus: MarketsResponse["streamStatus"],
  staleAfterMs: number,
): MarketsResponse["markets"][number]["freshness"] {
  if (!lastQuoteAt) {
    return streamStatus;
  }
  if (Date.now() - Date.parse(lastQuoteAt) > staleAfterMs) {
    return "STALE";
  }
  return streamStatus === "DISCONNECTED" ? "DELAYED" : streamStatus;
}
