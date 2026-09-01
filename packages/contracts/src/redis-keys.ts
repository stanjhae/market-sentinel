export const REDIS_KEYS = {
  quote: (symbol: string) => `sentinel:quote:${symbol}`,
  stream: "sentinel:stream",
  account: "sentinel:account",
  ticksChannel: "sentinel:ticks",
  candle: (symbol: string, timeframe: string) => `sentinel:candle:${symbol}:${timeframe}`,
  indicators: (symbol: string, timeframe: string) => `sentinel:indicators:${symbol}:${timeframe}`,
  candlesChannel: "sentinel:candles",
} as const;
