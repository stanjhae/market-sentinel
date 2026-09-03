import { describe, expect, it } from "vitest";
import { reclaimActiveJobs, removeJobsByName } from "./reclaim-jobs.js";

describe("reclaimActiveJobs", () => {
  it("unlocks leftover active jobs before remove so a held lock cannot block concurrency 1", async () => {
    const removed: string[] = [];
    const unlocked: string[] = [];
    const kept = { id: "keep", name: "account-sync", remove: async () => undefined };
    await expect(
      reclaimActiveJobs({
        queue: {
          unlockJob: async (job) => {
            unlocked.push(job.jobId);
          },
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
    expect(unlocked).toEqual(["zombie", "keep"]);
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
