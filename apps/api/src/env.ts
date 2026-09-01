import { envSchema } from "@market-sentinel/config";

export function loadApiEnv() {
  return envSchema.parse({
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ?? "postgres://sentinel:sentinel@localhost:5432/market_sentinel",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  });
}
