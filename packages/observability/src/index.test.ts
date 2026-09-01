import { describe, expect, it } from "vitest";
import { createLogger } from "./index.js";

describe("createLogger", () => {
  it("creates a named logger with requestId bindings", () => {
    const logger = createLogger("test", { requestId: "req-1" });
    expect(logger.bindings()).toMatchObject({ name: "test", requestId: "req-1" });
  });
});
