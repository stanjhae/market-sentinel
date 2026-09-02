import { describe, expect, it } from "vitest";
import { sessionAfterCheckFailure } from "./session-fallback";

describe("sessionAfterCheckFailure", () => {
  it("fails closed so a gated stream is not opened", () => {
    expect(sessionAfterCheckFailure()).toEqual({ required: true, authenticated: false });
  });
});
