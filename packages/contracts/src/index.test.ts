import { describe, expect, it } from "vitest";
import {
  authSessionSchema,
  executionPreviewSchema,
  healthLiveSchema,
  healthReadySchema,
  queueStatsSchema,
  readQueueStatsPayload,
  sseEventSchema,
} from "./index.js";

describe("contracts", () => {
  it("accepts a live health payload", () => {
    expect(healthLiveSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
  });

  it("accepts ready payload with optional non-gating queue fields", () => {
    expect(
      healthReadySchema.parse({
        ready: true,
        checks: { database: true, redis: true, marketStream: true, credentials: true },
      }).queueDepth,
    ).toBeUndefined();
    expect(
      healthReadySchema.parse({
        ready: false,
        checks: { database: true, redis: true, marketStream: false, credentials: true },
        queueDepth: 2,
        workerLagMs: 40,
      }).workerLagMs,
    ).toBe(40);
    expect(queueStatsSchema.parse({ depth: 0, lagMs: 12, updatedAt: "2026-09-02T00:00:00.000Z" }).depth).toBe(0);
    expect(readQueueStatsPayload({ raw: null })).toEqual({ queueDepth: null, workerLagMs: null });
    expect(
      readQueueStatsPayload({
        raw: JSON.stringify({ depth: 3, lagMs: 0, updatedAt: "2026-09-02T00:00:00.000Z" }),
        now: Date.parse("2026-09-02T00:01:30.000Z"),
      }),
    ).toEqual({ queueDepth: 3, workerLagMs: 90_000 });
  });

  it("accepts Milestone 5 SSE event types without replaying history", () => {
    expect(
      sseEventSchema.parse({
        type: "signal",
        payload: { id: "sig-1", instrumentId: "inst-1", symbol: "US30", state: "DETECTED", score: 72 },
      }).type,
    ).toBe("signal");
    expect(
      sseEventSchema.parse({
        type: "alert",
        payload: {
          id: "a1",
          type: "WATCHLIST_OPPORTUNITY",
          instrumentId: "inst-1",
          symbol: "US30",
          signalId: "sig-1",
          zoneId: null,
          title: "US30 — SHORT WATCH — 84/100",
          body: "4H bearish correction.",
          score: 84,
          direction: "SHORT",
          state: "DETECTED",
          dedupeKey: "WATCHLIST_OPPORTUNITY:inst-1:sig-1:DETECTED",
          channels: ["in_app"],
          readAt: null,
          createdAt: "2026-09-02T00:00:00.000Z",
        },
      }).type,
    ).toBe("alert");
    expect(sseEventSchema.parse({ type: "account", payload: {} }).type).toBe("account");
    expect(sseEventSchema.parse({ type: "risk" }).type).toBe("risk");
  });

  it("accepts an auth session envelope", () => {
    expect(authSessionSchema.parse({ required: false, authenticated: true })).toEqual({
      required: false,
      authenticated: true,
    });
    expect(authSessionSchema.parse({ required: true, authenticated: false }).authenticated).toBe(false);
  });

  it("accepts a Demo execution preview envelope", () => {
    expect(
      executionPreviewSchema.parse({
        allowed: true,
        blockReasons: [],
        nonce: "n",
        requestId: "11111111-1111-4111-8111-111111111111",
        action: "open",
        amount: "50",
        instrumentId: 27,
        leverage: 1,
        stopLoss: "99",
        takeProfit: "110",
        costs: [],
        evaluation: null,
      }).leverage,
    ).toBe(1);
  });
});
