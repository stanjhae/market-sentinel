import type { Env } from "@market-sentinel/config";
import { createLogger } from "@market-sentinel/observability";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  JOB_EVERY_MS,
  JOB_LOCK_DURATION_MS,
  JOB_NAMES,
  JOB_RETENTION,
  QUEUE_NAME,
  QUEUE_PREFIX,
  shouldScheduleExecutionReconcile,
} from "./names.js";
import { publishQueueStats } from "./queue-stats.js";

const logger = createLogger("worker");

export type DurableJobHandlers = {
  candleReconcile: () => Promise<void>;
  accountSync: (args: { force?: boolean }) => Promise<void>;
  executionReconcile: () => Promise<void>;
};

export type DurableJobs = {
  stop: () => Promise<void>;
  enqueueAccountSync: (args: { force: boolean }) => Promise<void>;
};

function createBullConnection(args: { redisUrl: string }): Redis {
  const connection = new Redis(args.redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  connection.on("error", (error) => {
    logger.warn({ err: error }, "bullmq redis error");
  });
  return connection;
}

async function closeConnection(args: { connection: Redis }): Promise<void> {
  args.connection.disconnect();
}

export async function startDurableJobs(args: {
  env: Env;
  redis: Redis;
  handlers: DurableJobHandlers;
}): Promise<DurableJobs> {
  const queueConnection = createBullConnection({ redisUrl: args.env.REDIS_URL });
  const workerConnection = createBullConnection({ redisUrl: args.env.REDIS_URL });
  try {
    await Promise.all([queueConnection.connect(), workerConnection.connect()]);
  } catch (error) {
    logger.warn({ err: error }, "bullmq redis unavailable; scheduled jobs disabled");
    await Promise.all([closeConnection({ connection: queueConnection }), closeConnection({ connection: workerConnection })]);
    return {
      stop: async () => undefined,
      enqueueAccountSync: async () => undefined,
    };
  }

  const queue = new Queue(QUEUE_NAME, { connection: queueConnection, prefix: QUEUE_PREFIX });
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const jobLogger = createLogger("worker", { jobName: job.name, jobId: job.id });
      if (job.name === JOB_NAMES.candleReconcile) {
        await args.handlers.candleReconcile();
      } else if (job.name === JOB_NAMES.accountSync) {
        const force = Boolean((job.data as { force?: boolean } | undefined)?.force);
        await args.handlers.accountSync({ force });
      } else if (job.name === JOB_NAMES.executionReconcile) {
        await args.handlers.executionReconcile();
      } else {
        jobLogger.warn({ jobName: job.name }, "unknown durable job name");
      }
      try {
        const counts = await queue.getJobCounts("wait", "active", "delayed");
        await publishQueueStats({
          redis: args.redis,
          counts,
          now: () => Date.now(),
        });
      } catch (error) {
        jobLogger.warn({ err: error }, "queue stats skipped");
      }
    },
    {
      connection: workerConnection,
      prefix: QUEUE_PREFIX,
      concurrency: 1,
      lockDuration: JOB_LOCK_DURATION_MS,
    },
  );
  worker.on("failed", (job, error) => {
    logger.warn({ err: error, jobName: job?.name, jobId: job?.id }, "durable job failed");
  });

  await queue.upsertJobScheduler(
    JOB_NAMES.candleReconcile,
    { every: JOB_EVERY_MS.candleReconcile, immediately: false },
    { name: JOB_NAMES.candleReconcile, data: {}, opts: { ...JOB_RETENTION } },
  );
  await queue.upsertJobScheduler(
    JOB_NAMES.accountSync,
    { every: JOB_EVERY_MS.accountSync, immediately: false },
    { name: JOB_NAMES.accountSync, data: {}, opts: { ...JOB_RETENTION } },
  );
  if (
    shouldScheduleExecutionReconcile({
      accountType: args.env.ETORO_ACCOUNT_TYPE,
      demoExecutionEnabled: args.env.DEMO_EXECUTION_ENABLED,
    })
  ) {
    await queue.upsertJobScheduler(
      JOB_NAMES.executionReconcile,
      { every: JOB_EVERY_MS.executionReconcile, immediately: false },
      { name: JOB_NAMES.executionReconcile, data: {}, opts: { ...JOB_RETENTION } },
    );
  } else {
    await queue.removeJobScheduler(JOB_NAMES.executionReconcile);
  }

  return {
    enqueueAccountSync: async (job) => {
      await queue.add(JOB_NAMES.accountSync, { force: job.force }, { ...JOB_RETENTION });
    },
    stop: async () => {
      await worker.close();
      await queue.close();
      await Promise.all([
        closeConnection({ connection: queueConnection }),
        closeConnection({ connection: workerConnection }),
      ]);
    },
  };
}
