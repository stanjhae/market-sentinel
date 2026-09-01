import { describe, expect, it } from "vitest";
import { isStreamStale, nextBackoffMs } from "./stream.js";

describe("stream helpers", () => {
  it("computes exponential backoff with jitter inside bounds", () => {
    const delay = nextBackoffMs({ attempt: 3, baseMs: 500, maxMs: 30_000, jitter: 0.5 });
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(2000);
  });

  it("marks a stream stale when last event is older than threshold", () => {
    const now = new Date("2026-09-01T12:00:00.000Z");
    expect(
      isStreamStale({
        lastEventAt: new Date("2026-09-01T11:59:40.000Z"),
        now,
        staleAfterMs: 15_000,
      }),
    ).toBe(true);
    expect(
      isStreamStale({
        lastEventAt: new Date("2026-09-01T11:59:50.000Z"),
        now,
        staleAfterMs: 15_000,
      }),
    ).toBe(false);
  });
});
