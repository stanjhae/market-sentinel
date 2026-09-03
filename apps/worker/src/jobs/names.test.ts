import { describe, expect, it } from "vitest";
import { JOB_EVERY_MS, JOB_LOCK_DURATION_MS, JOB_RETENTION, JOB_STALLED_INTERVAL_MS, shouldScheduleExecutionReconcile } from "./names.js";

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
    expect(JOB_LOCK_DURATION_MS).toBe(30_000);
    expect(JOB_STALLED_INTERVAL_MS).toBe(15_000);
    expect(
      shouldScheduleExecutionReconcile({ accountType: "real", demoExecutionEnabled: false }),
    ).toBe(false);
    expect(
      shouldScheduleExecutionReconcile({ accountType: "demo", demoExecutionEnabled: true }),
    ).toBe(true);
  });
});
