import { describe, expect, it } from "vitest";
import { barsElapsed15m, isUniqueViolation, bestOpenSignal } from "./signal-store.js";
import type { SignalRecord } from "@market-sentinel/strategies";

describe("barsElapsed15m", () => {
  it("counts closed 15m bars between two UTC times", () => {
    expect(
      barsElapsed15m({
        from: new Date("2026-09-01T12:00:00.000Z"),
        to: new Date("2026-09-01T12:00:00.000Z"),
      }),
    ).toBe(0);
    expect(
      barsElapsed15m({
        from: new Date("2026-09-01T12:00:00.000Z"),
        to: new Date("2026-09-02T00:00:00.000Z"),
      }),
    ).toBe(48);
  });
});

describe("persist conflicts", () => {
  it("recognizes postgres unique-violation 23505 including wrapped causes", () => {
    expect(isUniqueViolation({ error: { code: "23505" } })).toBe(true);
    expect(isUniqueViolation({ error: { cause: { code: "23505" } } })).toBe(true);
    expect(isUniqueViolation({ error: { code: "23503" } })).toBe(false);
    expect(isUniqueViolation({ error: new Error("nope") })).toBe(false);
  });

  it("picks the best trade setup and ignores do-not-chase", () => {
    const chase = {
      strategyKey: "do-not-chase",
      score: 99,
      state: "DETECTED",
    } as SignalRecord;
    const trade = {
      strategyKey: "sweep-reclaim",
      score: 61,
      state: "CONFIRMED",
    } as SignalRecord;
    expect(bestOpenSignal({ records: [chase, trade] })?.strategyKey).toBe("sweep-reclaim");
  });
});
