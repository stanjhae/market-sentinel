import { createLogger } from "@market-sentinel/observability";

const logger = createLogger("worker");

export function startWorker(args: { onIdle?: () => void } = {}): { stop: () => void } {
  logger.info("worker idle");
  args.onIdle?.();

  const stop = () => {
    logger.info("worker stopping");
  };

  return { stop };
}
