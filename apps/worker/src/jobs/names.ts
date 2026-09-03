export const QUEUE_NAME = "sentinel";
export const QUEUE_PREFIX = "sentinel:bull";

export const JOB_NAMES = {
  candleReconcile: "candle-reconcile",
  accountSync: "account-sync",
  executionReconcile: "execution-reconcile",
} as const;

export const JOB_EVERY_MS = {
  candleReconcile: 120_000,
  accountSync: 60_000,
  executionReconcile: 30_000,
} as const;

export const JOB_RETENTION = {
  removeOnComplete: { count: 20 },
  removeOnFail: { count: 50 },
} as const;

export const JOB_LOCK_DURATION_MS = 30_000;
export const JOB_STALLED_INTERVAL_MS = 15_000;

export function bullmqLockKey(args: { prefix: string; queueName: string; jobId: string }): string {
  return `${args.prefix}:${args.queueName}:${args.jobId}:lock`;
}

export function shouldScheduleExecutionReconcile(args: {
  accountType: "real" | "demo";
  demoExecutionEnabled: boolean;
}): boolean {
  return args.accountType === "demo" && args.demoExecutionEnabled;
}

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
