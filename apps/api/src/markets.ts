import type { AccountResponse, MarketRegimeDto, MarketsResponse, PriceZoneDto } from "@market-sentinel/contracts";
import { REDIS_KEYS } from "@market-sentinel/contracts";
import { WATCHLIST } from "@market-sentinel/domain";
import { Decimal } from "decimal.js";
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
      regime4h: null,
      structure1h: null,
      momentum15m: null,
      closestSupport: null,
      closestResistance: null,
      opportunityScore: null,
      opportunityLabel: null,
      signalState: null,
      signalExplanation: null,
      entryStatus: null,
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
    realizedDailyPnl: null,
    openPositionCount: null,
    historyUnavailable: false,
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
    const structure = await readStructureSnapshot({ redis, symbol, last: quote?.last ?? null });
    const signal = await readSignalSummary({ redis, symbol });
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
      ...structure,
      ...signal,
    });
  }
  markets.sort((left, right) => (right.opportunityScore ?? -1) - (left.opportunityScore ?? -1));
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
  return { ...emptyAccount(), ...(JSON.parse(raw) as Partial<AccountResponse>), available: true };
}

export async function readStructureSnapshot(args: {
  redis: Redis;
  symbol: string;
  last: string | null;
}): Promise<{
  regime4h: string | null;
  structure1h: string | null;
  momentum15m: string | null;
  closestSupport: string | null;
  closestResistance: string | null;
}> {
  const regimeRaw = await args.redis.get(REDIS_KEYS.regime(args.symbol));
  const zonesRaw = await args.redis.get(REDIS_KEYS.zones(args.symbol));
  const regimes = regimeRaw ? (JSON.parse(regimeRaw) as Partial<Record<"15m" | "1h" | "4h", MarketRegimeDto>>) : {};
  const zones = zonesRaw ? (JSON.parse(zonesRaw) as PriceZoneDto[]) : [];
  const active = zones.filter((zone) => zone.status === "ACTIVE");
  const supports = active.filter((zone) => zone.type === "SUPPORT" || zone.type === "BOTH");
  const resistances = active.filter((zone) => zone.type === "RESISTANCE" || zone.type === "BOTH");
  const timing = regimes["15m"];
  return {
    regime4h: regimes["4h"]?.trend ?? null,
    structure1h: regimes["1h"]?.structure ?? null,
    momentum15m: timing?.location ?? timing?.structure ?? null,
    closestSupport: closestMidpoint({ last: args.last, zones: supports }),
    closestResistance: closestMidpoint({ last: args.last, zones: resistances }),
  };
}

export async function readSignalSummary(args: { redis: Redis; symbol: string }): Promise<{
  opportunityScore: number | null;
  opportunityLabel: string | null;
  signalState: string | null;
  signalExplanation: string | null;
  entryStatus: string | null;
}> {
  const raw = await args.redis.get(REDIS_KEYS.signals(args.symbol));
  if (!raw) {
    return {
      opportunityScore: null,
      opportunityLabel: null,
      signalState: null,
      signalExplanation: null,
      entryStatus: null,
    };
  }
  const parsed = JSON.parse(raw) as {
    opportunityScore?: number | null;
    opportunityLabel?: string | null;
    signalState?: string | null;
    signalExplanation?: string | null;
    entryStatus?: string | null;
  };
  return {
    opportunityScore: parsed.opportunityScore ?? null,
    opportunityLabel: parsed.opportunityLabel ?? null,
    signalState: parsed.signalState ?? null,
    signalExplanation: parsed.signalExplanation ?? null,
    entryStatus: parsed.entryStatus ?? null,
  };
}

function closestMidpoint(args: { last: string | null; zones: PriceZoneDto[] }): string | null {
  if (args.zones.length === 0) {
    return null;
  }
  if (!args.last) {
    return args.zones[0]?.midpoint ?? null;
  }
  const last = new Decimal(args.last);
  return args.zones
    .slice()
    .sort((left, right) => new Decimal(left.midpoint).minus(last).abs().cmp(new Decimal(right.midpoint).minus(last).abs()))[0]
    ?.midpoint ?? null;
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
