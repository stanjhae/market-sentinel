import { describe, expect, it } from "vitest";
import { mapStatusForTest } from "./status.js";

describe("worker status mapping", () => {
  it("maps reconnecting to delayed", () => {
    expect(mapStatusForTest("RECONNECTING")).toBe("DELAYED");
    expect(mapStatusForTest("LIVE")).toBe("LIVE");
  });
});
