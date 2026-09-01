import { describe, expect, it } from "vitest";
import { instruments, auditLogs, candles, indicatorSnapshots } from "./schema.js";

describe("schema", () => {
  it("defines instrument, candle, and audit tables", () => {
    expect(instruments).toBeDefined();
    expect(auditLogs).toBeDefined();
    expect(candles).toBeDefined();
    expect(indicatorSnapshots).toBeDefined();
  });
});
