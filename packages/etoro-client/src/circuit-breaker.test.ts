import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "./circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("opens after the failure threshold and half-opens after reset", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetMs: 1000 });
    breaker.recordFailure(0);
    expect(breaker.allow(0)).toBe(true);
    breaker.recordFailure(0);
    expect(breaker.allow(0)).toBe(false);
    expect(breaker.state(500)).toBe("open");
    expect(breaker.state(1000)).toBe("half_open");
    breaker.recordSuccess();
    expect(breaker.allow(1000)).toBe(true);
  });
});
