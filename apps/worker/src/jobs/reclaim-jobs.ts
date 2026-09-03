export type ReclaimableJob = {
  id?: string;
  name: string;
  remove: () => Promise<unknown>;
};

export type ReclaimableQueue = {
  getJobs: (types: Array<"active" | "wait" | "delayed">) => Promise<ReclaimableJob[]>;
};

export async function reclaimActiveJobs(args: { queue: ReclaimableQueue }): Promise<number> {
  const active = await args.queue.getJobs(["active"]);
  let removed = 0;
  for (const job of active) {
    try {
      await job.remove();
      removed += 1;
    } catch {
      // Lock may still be held; the stalled check will pick it up after JOB_LOCK_DURATION_MS.
    }
  }
  return removed;
}

export async function removeJobsByName(args: { queue: ReclaimableQueue; name: string }): Promise<number> {
  const jobs = await args.queue.getJobs(["wait", "delayed", "active"]);
  let removed = 0;
  for (const job of jobs) {
    if (job.name !== args.name) {
      continue;
    }
    try {
      await job.remove();
      removed += 1;
    } catch {
      // Ignore jobs the current worker cannot unlock.
    }
  }
  return removed;
}
