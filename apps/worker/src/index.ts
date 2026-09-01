import { createLogger } from "@market-sentinel/observability";
import { loadWorkerEnv } from "./env.js";
import { startMarketWorker } from "./runtime.js";

const logger = createLogger("worker");

const worker = await startMarketWorker(loadWorkerEnv());

const shutdown = () => {
  void worker.stop().then(() => {
    logger.info("worker stopped");
    process.exit(0);
  });
};

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
