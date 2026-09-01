import { describe, expect, it } from "vitest";
import { RISK_ENGINE_PACKAGE } from "./index.js";

describe("risk-engine skeleton", () => {
  it("is reserved for server-side risk decisions", () => {
    expect(RISK_ENGINE_PACKAGE).toBe("risk-engine");
  });
});
