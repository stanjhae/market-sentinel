import { createLogger } from "@market-sentinel/observability";
import { buildServer } from "./server.js";

const logger = createLogger("api");

async function main() {
  const { app, env } = await buildServer();
  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
  logger.info({ port: env.API_PORT }, "api listening");
}

void main();
