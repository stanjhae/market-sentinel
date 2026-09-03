import { describe, expect, it } from "vitest";
import { JOB_EVERY_MS, JOB_RETENTION } from "./names.js";

describe("job scheduler defaults", () => {
  it("waits a full interval before the first repeatable run and caps Redis job history", () => {
    expect({ every: JOB_EVERY_MS.accountSync, immediately: false }).toEqual({
      every: 60_000,
      immediately: false,
    });
    expect({ every: JOB_EVERY_MS.candleReconcile, immediately: false }.immediately).toBe(false);
    expect({ every: JOB_EVERY_MS.executionReconcile, immediately: false }.immediately).toBe(false);
    expect(JOB_RETENTION).toEqual({
      removeOnComplete: { count: 20 },
      removeOnFail: { count: 50 },
    });
  });
});
