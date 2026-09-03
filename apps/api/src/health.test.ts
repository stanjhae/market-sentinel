import { describe, expect, it } from "vitest";
import { composeReady } from "./health.js";

const healthy = {
  database: true,
  redis: true,
  credentials: true,
  marketStream: true,
};

describe("composeReady", () => {
  it("is ready only when every check is true", () => {
    expect(composeReady({ checks: healthy })).toBe(true);
  });

  it("is not ready when the database is down even if the stream is live", () => {
    expect(composeReady({ checks: { ...healthy, database: false } })).toBe(false);
  });

  it("does not let a down stream hide a database failure", () => {
    expect(composeReady({ checks: { ...healthy, database: false, marketStream: false } })).toBe(false);
    expect(composeReady({ checks: { ...healthy, marketStream: false } })).toBe(false);
  });

  it("does not use queue depth or lag when composing ready", () => {
    expect(composeReady({ checks: healthy })).toBe(true);
    expect(composeReady({ checks: { ...healthy, redis: false } })).toBe(false);
  });
});
