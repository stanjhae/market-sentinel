import { describe, expect, it } from "vitest";
import { instruments, auditLogs, candles, indicatorSnapshots, pivots, priceZones, marketRegimes, signals, alerts, appSettings, journalEntries, backtestRuns } from "./schema.js";

describe("schema", () => {
  it("defines instrument, candle, and audit tables", () => {
    expect(instruments).toBeDefined();
    expect(auditLogs).toBeDefined();
    expect(candles).toBeDefined();
    expect(indicatorSnapshots).toBeDefined();
    expect(pivots).toBeDefined();
    expect(priceZones).toBeDefined();
    expect(marketRegimes).toBeDefined();
    expect(signals).toBeDefined();
    expect(alerts).toBeDefined();
    expect(appSettings).toBeDefined();
    expect(journalEntries).toBeDefined();
    expect(backtestRuns).toBeDefined();
  });
});
