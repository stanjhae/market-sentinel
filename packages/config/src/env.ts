import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  value === "" || value === undefined ? undefined : value;

const LOCAL_DATABASE_URL = "postgres://sentinel:sentinel@localhost:5432/market_sentinel";
const LOCAL_REDIS_URL = "redis://localhost:6379";

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    API_PORT: z.coerce.number().int().positive().default(3001),
    WEB_PORT: z.coerce.number().int().positive().default(3000),
    APP_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(12).optional()),
    ETORO_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    ETORO_USER_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    ETORO_ACCOUNT_TYPE: z.enum(["real", "demo"]).default("real"),
    DEMO_EXECUTION_ENABLED: z.preprocess((value) => {
      if (value === true || value === "true" || value === "1") {
        return true;
      }
      return false;
    }, z.boolean().default(false)),
    ETORO_REST_BASE_URL: z
      .string()
      .url()
      .default("https://public-api.etoro.com"),
    ETORO_WS_URL: z.string().url().default("wss://ws.etoro.com/ws"),
    STALE_TICK_MS: z.coerce.number().int().positive().default(15_000),
    TELEGRAM_BOT_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    TELEGRAM_CHAT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") {
      return;
    }
    if (!env.APP_PASSWORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["APP_PASSWORD"],
        message: "APP_PASSWORD is required in production",
      });
    }
    if (!env.ETORO_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ETORO_API_KEY"],
        message: "ETORO_API_KEY is required in production",
      });
    }
    if (!env.ETORO_USER_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ETORO_USER_KEY"],
        message: "ETORO_USER_KEY is required in production",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function withLocalInfraDefaults(args: { source: NodeJS.ProcessEnv }): NodeJS.ProcessEnv {
  const nodeEnv = args.source.NODE_ENV ?? "development";
  if (nodeEnv === "production") {
    return args.source;
  }
  return {
    ...args.source,
    DATABASE_URL: args.source.DATABASE_URL ?? LOCAL_DATABASE_URL,
    REDIS_URL: args.source.REDIS_URL ?? LOCAL_REDIS_URL,
  };
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}

export function hasEtoroCredentials(env: Env): boolean {
  return Boolean(env.ETORO_API_KEY && env.ETORO_USER_KEY);
}

export function hasTelegramCredentials(args: { env: Env }): boolean {
  return Boolean(args.env.TELEGRAM_BOT_TOKEN && args.env.TELEGRAM_CHAT_ID);
}
