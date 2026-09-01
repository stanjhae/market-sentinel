import { describe, expect, it } from "vitest";
import { STRATEGIES_PACKAGE } from "./index.js";

describe("strategies skeleton", () => {
  it("is reserved for versioned setup detectors", () => {
    expect(STRATEGIES_PACKAGE).toBe("strategies");
  });
});
