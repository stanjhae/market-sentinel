import { describe, expect, it } from "vitest";
import { WATCHLIST, isWatchlistSymbol, parseWatchlistSymbol, type Trend, type ZoneSource } from "./index.js";

describe("WATCHLIST", () => {
  it("contains the four MVP instruments", () => {
    expect(WATCHLIST).toEqual(["US30", "US100", "SPX500", "GOLD"]);
  });

  it("rejects unknown symbols", () => {
    expect(isWatchlistSymbol("BTC")).toBe(false);
    expect(isWatchlistSymbol("US30")).toBe(true);
    expect(isWatchlistSymbol("us30")).toBe(false);
    expect(parseWatchlistSymbol({ value: "us30" })).toBe("US30");
    expect(parseWatchlistSymbol({ value: "btc" })).toBeNull();
  });

  it("reserves Milestone 3 regime and zone enums", () => {
    const trend: Trend = "STRONG_BULL";
    const source: ZoneSource = "AUTO_PIVOT";
    expect(trend).toBe("STRONG_BULL");
    expect(source).toBe("AUTO_PIVOT");
  });
});
