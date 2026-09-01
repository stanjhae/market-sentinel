export const REDIS_KEYS = {
  quote: (symbol: string) => `sentinel:quote:${symbol}`,
  stream: "sentinel:stream",
  account: "sentinel:account",
  ticksChannel: "sentinel:ticks",
  candle: (symbol: string, timeframe: string) => `sentinel:candle:${symbol}:${timeframe}`,
  indicators: (symbol: string, timeframe: string) => `sentinel:indicators:${symbol}:${timeframe}`,
  candlesChannel: "sentinel:candles",
  regime: (symbol: string) => `sentinel:regime:${symbol}`,
  zones: (symbol: string) => `sentinel:zones:${symbol}`,
} as const;
