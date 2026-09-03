import { describe, expect, it } from "vitest";
import { reclaimActiveJobs, removeJobsByName } from "./reclaim-jobs.js";

describe("reclaimActiveJobs", () => {
  it("removes leftover active jobs after a worker crash", async () => {
    const removed: string[] = [];
    const kept = { id: "keep", name: "account-sync", remove: async () => undefined };
    await expect(
      reclaimActiveJobs({
        queue: {
          getJobs: async () => [
            {
              id: "zombie",
              name: "account-sync",
              remove: async () => {
                removed.push("zombie");
              },
            },
            kept,
          ],
        },
      }),
    ).resolves.toBe(2);
    expect(removed).toEqual(["zombie"]);
  });
});

describe("removeJobsByName", () => {
  it("drops leftover jobs for a disabled scheduler", async () => {
    const removed: string[] = [];
    await expect(
      removeJobsByName({
        queue: {
          getJobs: async () => [
            {
              name: "execution-reconcile",
              remove: async () => {
                removed.push("execution-reconcile");
              },
            },
            { name: "account-sync", remove: async () => undefined },
          ],
        },
        name: "execution-reconcile",
      }),
    ).resolves.toBe(1);
    expect(removed).toEqual(["execution-reconcile"]);
  });
});
