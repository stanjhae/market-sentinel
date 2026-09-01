export type EtoroAccountType = "real" | "demo";

export type EtoroClientConfig = {
  apiKey: string;
  userKey: string;
  accountType: EtoroAccountType;
  restBaseUrl: string;
  wsUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  staleAfterMs?: number;
};

export type InstrumentSearchItem = {
  instrumentId: number;
  displayname?: string;
  internalSymbolFull?: string;
  instrumentType?: string;
  internalAssetClassName?: string;
  dailyPriceChange?: number;
};

export type InstrumentSearchResponse = {
  page?: number;
  pageSize?: number;
  totalItems?: number;
  items?: InstrumentSearchItem[];
};

export type LiveRate = {
  instrumentID: number;
  ask?: number;
  bid?: number;
  lastExecution?: number;
  date?: string;
  priceRateID?: number;
};

export type LiveRatesResponse = {
  rates?: LiveRate[];
};

export type AggregatedPortfolioTotals = {
  accountAvailableCash?: number;
  accountFrozenCash?: number;
  accountCurrentPnl?: number;
  accountTotalValue?: number;
  accountTotalUsedMargin?: number;
  accountBalance?: number;
};

export type AggregatedPortfolioResponse = {
  cid?: number;
  timestamp?: string;
  accountCurrency?: string;
  accountTotals?: AggregatedPortfolioTotals;
};

export type EtoroCandleIntervalName =
  | "OneMinute"
  | "FiveMinutes"
  | "TenMinutes"
  | "FifteenMinutes"
  | "ThirtyMinutes"
  | "OneHour"
  | "FourHours"
  | "OneDay"
  | "OneWeek";

export type EtoroHistoryCandle = {
  instrumentID?: number;
  fromDate?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
};

export type EtoroInstrumentCandleGroup = {
  instrumentId?: number;
  candles?: EtoroHistoryCandle[];
  rangeOpen?: number;
  rangeClose?: number;
  rangeHigh?: number;
  rangeLow?: number;
  volume?: number;
};

export type EtoroCandlesResponse = {
  interval?: EtoroCandleIntervalName;
  candles?: EtoroInstrumentCandleGroup[];
};

export type NormalizedHistoryCandle = {
  etoroInstrumentId: number;
  fromDate: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
};

export type MarketTick = {
  instrumentId: number;
  bid: string | null;
  ask: string | null;
  last: string | null;
  quotedAt: string;
  priceRateId: string | null;
};
