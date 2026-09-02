import { describe, expect, it } from "vitest";
import { hasEtoroCredentials, hasTelegramCredentials, parseEnv } from "./env.js";

const validBase = {
  DATABASE_URL: "postgres://sentinel:sentinel@localhost:5432/market_sentinel",
  REDIS_URL: "redis://localhost:6379",
};

describe("parseEnv", () => {
  it("parses required infrastructure URLs and defaults", () => {
    const env = parseEnv(validBase);
    expect(env.API_PORT).toBe(3001);
    expect(env.ETORO_ACCOUNT_TYPE).toBe("real");
    expect(hasEtoroCredentials(env)).toBe(false);
  });

  it("treats empty eToro keys as missing", () => {
    const env = parseEnv({
      ...validBase,
      ETORO_API_KEY: "",
      ETORO_USER_KEY: "",
    });
    expect(env.ETORO_API_KEY).toBeUndefined();
    expect(hasEtoroCredentials(env)).toBe(false);
  });

  it("rejects NEXT_PUBLIC eToro keys as env contract fields", () => {
    const env = parseEnv(validBase);
    expect("NEXT_PUBLIC_ETORO_API_KEY" in env).toBe(false);
  });

  it("keeps Demo execution disabled unless explicitly true", () => {
    expect(parseEnv(validBase).DEMO_EXECUTION_ENABLED).toBe(false);
    expect(parseEnv({ ...validBase, DEMO_EXECUTION_ENABLED: "false" }).DEMO_EXECUTION_ENABLED).toBe(false);
    expect(parseEnv({ ...validBase, DEMO_EXECUTION_ENABLED: "true" }).DEMO_EXECUTION_ENABLED).toBe(true);
    expect("NEXT_PUBLIC_DEMO_EXECUTION_ENABLED" in parseEnv(validBase)).toBe(false);
  });

  it("rejects APP_PASSWORD shorter than 12 characters", () => {
    expect(() => parseEnv({ ...validBase, APP_PASSWORD: "short" })).toThrow();
    expect(parseEnv({ ...validBase, APP_PASSWORD: "correct-horse" }).APP_PASSWORD).toBe("correct-horse");
    expect("NEXT_PUBLIC_APP_PASSWORD" in parseEnv(validBase)).toBe(false);
  });

  it("treats empty Telegram credentials as missing and never NEXT_PUBLIC", () => {
    const env = parseEnv({
      ...validBase,
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_CHAT_ID: "",
    });
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(env.TELEGRAM_CHAT_ID).toBeUndefined();
    expect("NEXT_PUBLIC_TELEGRAM_BOT_TOKEN" in env).toBe(false);
    expect(hasTelegramCredentials({ env })).toBe(false);
  });
});
