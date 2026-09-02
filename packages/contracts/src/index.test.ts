import { describe, expect, it } from "vitest";
import { healthLiveSchema, sseEventSchema } from "./index.js";

describe("contracts", () => {
  it("accepts a live health payload", () => {
    expect(healthLiveSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
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
});
