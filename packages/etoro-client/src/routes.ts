/**
 * Routes confirmed from eToro Public API OpenAPI v1.365.1
 * (api-portal.etoro.com). Do not add money-moving paths here.
 */
export const ETORO_ROUTES = {
  searchInstruments: "/api/v1/market-data/search",
  instrumentRates: "/api/v1/market-data/instruments/rates",
  aggregatePortfolioReal: "/api/v1/trading/info/aggregate-portfolio",
  aggregatePortfolioDemo: "/api/v1/trading/info/demo/aggregate-portfolio",
} as const;

export const ETORO_CANDLE_INTERVAL = {
  "15m": "FifteenMinutes",
  "1h": "OneHour",
  "4h": "FourHours",
} as const;

export type EtoroCandleInterval = (typeof ETORO_CANDLE_INTERVAL)[keyof typeof ETORO_CANDLE_INTERVAL];

/** OpenAPI v1.365.1 — GET /api/v1/market-data/instruments/{instrumentId}/history/candles/{direction}/{interval}/{candlesCount} */
export function instrumentCandleHistoryPath(args: {
  instrumentId: number;
  direction: "asc" | "desc";
  interval: EtoroCandleInterval;
  candlesCount: number;
}): string {
  const count = Math.min(1000, Math.max(1, Math.floor(args.candlesCount)));
  return `/api/v1/market-data/instruments/${args.instrumentId}/history/candles/${args.direction}/${args.interval}/${count}`;
}

export const ETORO_ORIGIN = "https://public-api.etoro.com";
export const ETORO_WS_URL = "wss://ws.etoro.com/ws";
