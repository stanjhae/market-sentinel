import { describe, expect, it } from "vitest";
import { createRequestId } from "./request-id.js";

describe("createRequestId", () => {
  it("returns unique UUIDs", () => {
    const first = createRequestId();
    const second = createRequestId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(first).not.toBe(second);
  });
});
