import { describe, expect, it } from "vitest";
import { runAccountSync } from "./account-sync.js";

describe("runAccountSync", () => {
  it("forwards the force flag to the existing upsert", async () => {
    const seen: Array<{ force?: boolean }> = [];
    await runAccountSync({
      force: true,
      sync: async (args) => {
        seen.push(args);
      },
    });
    await runAccountSync({
      sync: async (args) => {
        seen.push(args);
      },
    });
    expect(seen).toEqual([{ force: true }, { force: undefined }]);
  });
});
