import { describe, expect, it } from "vitest";
import { readQueueStatsPayload } from "@market-sentinel/contracts";
import { publishQueueStats, queueDepthFromCounts } from "./queue-stats.js";

describe("queue stats", () => {
  it("sums wait, active, and delayed counts", () => {
    expect(queueDepthFromCounts({ counts: { wait: 1, active: 2, delayed: 3 } })).toBe(6);
    expect(queueDepthFromCounts({ counts: {} })).toBe(0);
  });

  it("computes worker lag from updatedAt at read time so a dead worker ages", async () => {
    const writes: string[] = [];
    await publishQueueStats({
      redis: {
        set: async (_key: string, value: string) => {
          writes.push(value);
          return "OK";
        },
      } as never,
      counts: { wait: 1, active: 0, delayed: 0 },
      now: () => Date.parse("2026-09-02T00:00:00.000Z"),
    });
    expect(
      readQueueStatsPayload({
        raw: writes[0] ?? null,
        now: Date.parse("2026-09-02T00:02:00.000Z"),
      }),
    ).toEqual({ queueDepth: 1, workerLagMs: 120_000 });
    expect(readQueueStatsPayload({ raw: null })).toEqual({ queueDepth: null, workerLagMs: null });
    expect(readQueueStatsPayload({ raw: "{" })).toEqual({ queueDepth: null, workerLagMs: null });
  });
});
