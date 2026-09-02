import { describe, expect, it } from "vitest";
import { identityChanged, isUsablePnlSnapshot, minDateString } from "@market-sentinel/risk-engine";

describe("account reconciliation helpers", () => {
  it("treats open rate, units, or open time changes as conflicts", () => {
    expect(
      identityChanged({
        previous: { openPrice: "100", units: "1", openedAt: "2026-09-01T00:00:00.000Z" },
        next: { openPrice: "100", units: "2", openedAt: "2026-09-01T00:00:00.000Z" },
      }),
    ).toBe(true);
    expect(
      identityChanged({
        previous: { openPrice: "100", units: "1", openedAt: "2026-09-01T00:00:00.000Z" },
        next: { openPrice: "100", units: "1", openedAt: "2026-09-01T00:00:00.000Z" },
      }),
    ).toBe(false);
  });

  it("uses a 30-day UTC lookback for history minDate", () => {
    expect(minDateString({ now: new Date("2026-09-02T15:00:00.000Z"), lookbackDays: 30 })).toBe("2026-08-03");
  });

  it("does not treat equivalent open-time strings as a conflict", () => {
    expect(
      identityChanged({
        previous: { openPrice: "52775.8", units: "0.03", openedAt: "2026-09-01T19:18:41.107+00:00" },
        next: { openPrice: "52775.8", units: "0.03", openedAt: "2026-09-01T19:18:41.107Z" },
      }),
    ).toBe(false);
  });

  it("requires credit and a positions array before applying a book", () => {
    expect(isUsablePnlSnapshot({ portfolio: {} })).toBe(false);
    expect(isUsablePnlSnapshot({ portfolio: { credit: 14.44, positions: [] } })).toBe(true);
  });
});
