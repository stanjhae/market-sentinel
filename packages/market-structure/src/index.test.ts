import { describe, expect, it } from "vitest";
import { MARKET_STRUCTURE_PACKAGE } from "./index.js";

describe("market-structure skeleton", () => {
  it("is reserved for pivots and zones", () => {
    expect(MARKET_STRUCTURE_PACKAGE).toBe("market-structure");
  });
});
