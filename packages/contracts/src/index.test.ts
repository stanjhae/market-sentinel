import { describe, expect, it } from "vitest";
import { healthLiveSchema } from "./index.js";

describe("contracts", () => {
  it("accepts a live health payload", () => {
    expect(healthLiveSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
  });
});
