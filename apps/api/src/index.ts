import { createLogger } from "@market-sentinel/observability";
import { buildServer } from "./server.js";

const logger = createLogger("api");

async function main() {
  const { app, env } = await buildServer();
  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
  logger.info({ port: env.API_PORT }, "api listening");

  const shutdown = () => {
    void app
      .close()
      .then(() => {
        logger.info("api stopped");
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, "api close failed");
        process.exit(1);
      });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void main();
