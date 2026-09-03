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

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
