import { describe, expect, it } from "vitest";
import { isIdempotentMethod, shouldRetry, shouldRetryExecutionPost } from "./retry.js";

describe("retry policy", () => {
  it("treats GET as idempotent and POST as unsafe", () => {
    expect(isIdempotentMethod("GET")).toBe(true);
    expect(isIdempotentMethod("POST")).toBe(false);
  });

  it("does not retry unsafe methods", () => {
    expect(shouldRetry({ method: "POST", status: 500, attempt: 1, maxAttempts: 3 })).toBe(false);
  });

  it("retries execution POST only on 429 with the same attempt budget", () => {
    expect(shouldRetryExecutionPost({ status: 429, attempt: 1, maxAttempts: 3 })).toBe(true);
    expect(shouldRetryExecutionPost({ status: 500, attempt: 1, maxAttempts: 3 })).toBe(false);
    expect(shouldRetryExecutionPost({ status: 400, attempt: 1, maxAttempts: 3 })).toBe(false);
    expect(shouldRetryExecutionPost({ status: undefined, attempt: 1, maxAttempts: 3 })).toBe(false);
    expect(shouldRetryExecutionPost({ status: 429, attempt: 3, maxAttempts: 3 })).toBe(false);
  });

  it("retries GET on 429 and 5xx within bounds", () => {
    expect(shouldRetry({ method: "GET", status: 429, attempt: 1, maxAttempts: 3 })).toBe(true);
    expect(shouldRetry({ method: "GET", status: 503, attempt: 2, maxAttempts: 3 })).toBe(true);
    expect(shouldRetry({ method: "GET", status: 503, attempt: 3, maxAttempts: 3 })).toBe(false);
    expect(shouldRetry({ method: "GET", status: 400, attempt: 1, maxAttempts: 3 })).toBe(false);
  });
});
