import { describe, expect, it } from "vitest";
import { disconnectedMarkets } from "./markets.js";

describe("disconnectedMarkets", () => {
  it("always returns the four watchlist symbols", () => {
    expect(disconnectedMarkets().markets.map((item) => item.symbol)).toEqual([
      "US30",
      "US100",
      "SPX500",
      "GOLD",
    ]);
  });
});
