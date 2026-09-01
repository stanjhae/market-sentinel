import { describe, expect, it } from "vitest";
import { WATCHLIST, isWatchlistSymbol, parseWatchlistSymbol } from "./index.js";

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
});
