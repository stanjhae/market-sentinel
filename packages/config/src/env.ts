import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  value === "" || value === undefined ? undefined : value;

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  APP_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(12).optional()),
  ETORO_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  ETORO_USER_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  ETORO_ACCOUNT_TYPE: z.enum(["real", "demo"]).default("real"),
  ETORO_REST_BASE_URL: z
    .string()
    .url()
    .default("https://public-api.etoro.com"),
  ETORO_WS_URL: z.string().url().default("wss://ws.etoro.com/ws"),
  STALE_TICK_MS: z.coerce.number().int().positive().default(15_000),
  TELEGRAM_BOT_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  TELEGRAM_CHAT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}

export function hasEtoroCredentials(env: Env): boolean {
  return Boolean(env.ETORO_API_KEY && env.ETORO_USER_KEY);
}

export function hasTelegramCredentials(args: { env: Env }): boolean {
  return Boolean(args.env.TELEGRAM_BOT_TOKEN && args.env.TELEGRAM_CHAT_ID);
}
