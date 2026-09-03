import { REDIS_KEYS, queueStatsSchema } from "@market-sentinel/contracts";
import type { Redis } from "ioredis";

export { readQueueStatsPayload } from "@market-sentinel/contracts";

export type QueueCounts = {
  wait?: number;
  active?: number;
  delayed?: number;
};

export function queueDepthFromCounts(args: { counts: QueueCounts }): number {
  return (args.counts.wait ?? 0) + (args.counts.active ?? 0) + (args.counts.delayed ?? 0);
}

export async function publishQueueStats(args: {
  redis: Redis;
  counts: QueueCounts;
  now?: () => number;
}): Promise<void> {
  const nowMs = (args.now ?? Date.now)();
  const updatedAt = new Date(nowMs).toISOString();
  const payload = queueStatsSchema.parse({
    depth: queueDepthFromCounts({ counts: args.counts }),
    lagMs: 0,
    updatedAt,
  });
  await args.redis.set(REDIS_KEYS.queueStats, JSON.stringify(payload));
}
