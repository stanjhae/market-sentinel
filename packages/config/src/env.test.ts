import { describe, expect, it } from "vitest";
import { hasEtoroCredentials, parseEnv } from "./env.js";

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
});
