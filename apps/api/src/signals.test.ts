import { describe, expect, it } from "vitest";
import { emptySignals, matchesFilters, parseSignalFilters, toSignalDto } from "./signals.js";

function signalRow(args: { symbol?: string; state?: string; triggerTimeframe?: string; score?: number }) {
  return {
    id: "sig-1",
    instrumentId: "inst-1",
    symbol: args.symbol ?? "US30",
    strategyKey: "breakdown-retest",
    strategyVersion: "1.0.0",
    direction: "SHORT",
    state: args.state ?? "WATCHING",
    triggerTimeframe: args.triggerTimeframe ?? "15m",
    detectedAt: new Date("2026-09-01T12:00:00.000Z"),
    watchingAt: new Date("2026-09-01T12:15:00.000Z"),
    confirmedAt: null,
    tradePlannedAt: null,
    invalidatedAt: null,
    expiredAt: null,
    dismissedAt: null,
    score: args.score ?? 84,
    confidenceLabel: "Strong",
    entryZoneLow: "100",
    entryZoneHigh: "102",
    invalidationPrice: "102.3",
    target1: "89",
    target2: null,
    target3: null,
    riskRewardToT1: "2.4",
    riskRewardToT2: null,
    lastEvaluatedOpenTimeUtc: new Date("2026-09-01T12:15:00.000Z"),
    evidenceJson: {},
    snapshotJson: {},
    createdAt: new Date("2026-09-01T12:00:00.000Z"),
    updatedAt: new Date("2026-09-01T12:15:00.000Z"),
  };
}

describe("parseSignalFilters", () => {
  it("reads list filters", () => {
    expect(
      parseSignalFilters({
        query: { scope: "active", instrument: "US30", strategy: "breakdown-retest", minScore: "70", timeframe: "15m" },
      }),
    ).toEqual({
      scope: "active",
      instrument: "US30",
      strategy: "breakdown-retest",
      direction: undefined,
      minScore: 70,
      state: undefined,
      timeframe: "15m",
    });
  });
});

describe("toSignalDto", () => {
  it("keeps score and entry status separate", () => {
    const dto = toSignalDto({ row: signalRow({}) });
    expect(dto.score).toBe(84);
    expect(dto.entryStatus).toBe("WAITING FOR CONFIRMATION");
    expect(emptySignals().available).toBe(false);
  });
});

describe("matchesFilters", () => {
  it("returns no match for an unknown instrument or timeframe", () => {
    const row = signalRow({ symbol: "US30" });
    expect(matchesFilters({ row, filters: { instrument: "US3" } })).toBe(false);
    expect(matchesFilters({ row, filters: { instrument: "BTC" } })).toBe(false);
    expect(matchesFilters({ row, filters: { instrument: "US30" } })).toBe(true);
    expect(matchesFilters({ row, filters: { timeframe: "2h" } })).toBe(false);
    expect(matchesFilters({ row, filters: { timeframe: "15m" } })).toBe(true);
  });
});
