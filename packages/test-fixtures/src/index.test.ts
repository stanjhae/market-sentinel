import { describe, expect, it } from "vitest";
import { FIXTURE_NAMES } from "./index.js";

describe("test-fixtures", () => {
  it("reserves replay fixture names from SPEC", () => {
    expect(FIXTURE_NAMES).toContain("do-not-chase-extension");
  });
});
