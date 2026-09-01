import { describe, expect, it } from "vitest";
import { pickUnambiguousInstrument } from "./resolve.js";

describe("pickUnambiguousInstrument", () => {
  it("resolves a single exact alias match", () => {
    const result = pickUnambiguousInstrument({
      symbol: "US30",
      items: [{ instrumentId: 1, internalSymbolFull: "DJ30", displayname: "Wall Street 30" }],
    });
    expect(result.resolved).toBe(true);
    expect(result.instrument?.instrumentId).toBe(1);
  });

  it("resolves eToro GOLD 24/7 via the mapped alias", () => {
    const result = pickUnambiguousInstrument({
      symbol: "GOLD",
      items: [{ instrumentId: 559, internalSymbolFull: "GOLD.24-7", displayname: "GOLD 24/7" }],
    });
    expect(result.resolved).toBe(true);
    expect(result.instrument?.instrumentId).toBe(559);
  });

  it("marks multiple exact matches as ambiguous", () => {
    const result = pickUnambiguousInstrument({
      symbol: "GOLD",
      items: [
        { instrumentId: 1, internalSymbolFull: "GOLD" },
        { instrumentId: 2, internalSymbolFull: "GOLD" },
      ],
    });
    expect(result.resolved).toBe(false);
    expect(result.ambiguous).toBe(true);
  });
});
