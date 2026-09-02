import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("secret boundary", () => {
  it("does not expose eToro credentials via NEXT_PUBLIC_ variables", () => {
    const envExample = readFileSync(resolve(process.cwd(), "../../.env.example"), "utf8");
    expect(envExample).not.toMatch(/NEXT_PUBLIC_ETORO_/);
    expect(envExample).not.toMatch(/NEXT_PUBLIC_TELEGRAM_/);
    expect(envExample).not.toMatch(/NEXT_PUBLIC_APP_PASSWORD/);
    expect(process.env.NEXT_PUBLIC_ETORO_API_KEY).toBeUndefined();
    expect(process.env.NEXT_PUBLIC_ETORO_USER_KEY).toBeUndefined();
    expect(process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN).toBeUndefined();
  });
});
