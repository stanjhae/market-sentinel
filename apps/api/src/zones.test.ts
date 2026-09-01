import { describe, expect, it } from "vitest";
import { emptyZones, orderedBounds, parseBoundString, parseManualZoneBody } from "./zones.js";

describe("parseManualZoneBody", () => {
  it("accepts bounds and computes a midpoint", () => {
    expect(
      parseManualZoneBody({
        body: { type: "SUPPORT", timeframe: "1h", lowerBound: "100", upperBound: "102", note: "session" },
      }),
    ).toEqual({
      ok: true,
      value: {
        type: "SUPPORT",
        timeframe: "1h",
        lowerBound: "100",
        upperBound: "102",
        midpoint: "101",
        note: "session",
      },
    });
  });

  it("accepts midpoint plus width", () => {
    const parsed = parseManualZoneBody({
      body: { type: "RESISTANCE", midpoint: "50", width: "2" },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.lowerBound).toBe("49");
      expect(parsed.value.upperBound).toBe("51");
    }
  });

  it("rejects missing, inverted, and non-numeric bounds", () => {
    expect(parseManualZoneBody({ body: { type: "BOTH" } }).ok).toBe(false);
    expect(parseManualZoneBody({ body: { type: "SUPPORT", lowerBound: "120", upperBound: "100" } }).ok).toBe(false);
    expect(parseManualZoneBody({ body: { type: "SUPPORT", lowerBound: "foo", upperBound: "100" } }).ok).toBe(false);
    expect(parseManualZoneBody({ body: { type: "RESISTANCE", midpoint: "50", width: "0" } }).ok).toBe(false);
    expect(emptyZones({ symbol: "US30" }).available).toBe(false);
  });

  it("accepts finite decimal bounds and rejects inverted pairs", () => {
    expect(parseBoundString({ value: "101.25" })).toBe("101.25");
    expect(parseBoundString({ value: "foo" })).toBeNull();
    expect(parseBoundString({ value: "Infinity" })).toBeNull();
    expect(orderedBounds({ lowerBound: "100", upperBound: "102" })).toBe(true);
    expect(orderedBounds({ lowerBound: "102", upperBound: "100" })).toBe(false);
  });
});
