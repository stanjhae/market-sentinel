import cors from "@fastify/cors";
import { hasEtoroCredentials } from "@market-sentinel/config";
import { createDb } from "@market-sentinel/db";
import { parseWatchlistSymbol } from "@market-sentinel/domain";
import Fastify from "fastify";
import { Redis } from "ioredis";
import { emptyCandles, parseIsoDateQuery, parseTimeframeQuery, readCandles, readMarketContext } from "./candles.js";
import { loadApiEnv } from "./env.js";
import { disconnectedMarkets, emptyAccount, readAccount, readMarkets } from "./markets.js";

export async function buildServer() {
  const env = loadApiEnv();
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redis.on("error", () => {
    // Connection failures are reflected in /health/ready and /markets.
  });
  const dbPair = createDb(env.DATABASE_URL);

  const pingDatabase = async () => {
    try {
      await dbPair.client`select 1 as ok`;
      return true;
    } catch {
      return false;
    }
  };

  const pingRedis = async () => {
    try {
      if (redis.status !== "ready") {
        await redis.connect();
      }
      return (await redis.ping()) === "PONG";
    } catch {
      return false;
    }
  };

  app.get("/health/live", async () => ({ status: "ok" as const }));

  app.get("/health/ready", async () => {
    const redisOk = await pingRedis();
    let marketStream = false;
    if (redisOk) {
      try {
        const snapshot = await readMarkets(redis, env.STALE_TICK_MS);
        marketStream = snapshot.streamStatus === "LIVE";
      } catch {
        marketStream = false;
      }
    }
    const checks = {
      database: await pingDatabase(),
      redis: redisOk,
      marketStream,
      credentials: hasEtoroCredentials(env),
    };
    return {
      ready: checks.redis && checks.credentials && checks.marketStream,
      checks,
    };
  });

  app.get("/markets", async () => {
    if (!(await pingRedis())) {
      return disconnectedMarkets();
    }
    return readMarkets(redis, env.STALE_TICK_MS);
  });

  app.get("/markets/:symbol/candles", async (request, reply) => {
    const params = request.params as { symbol: string };
    const query = request.query as { timeframe?: string; from?: string; to?: string };
    const timeframe = parseTimeframeQuery({ value: query.timeframe });
    if (!timeframe) {
      return reply.code(400).send({ error: "invalid timeframe" });
    }
    const from = parseIsoDateQuery({ value: query.from });
    const to = parseIsoDateQuery({ value: query.to });
    if (!from.ok || !to.ok || (from.date && to.date && from.date.getTime() > to.date.getTime())) {
      return reply.code(400).send({ error: "invalid date range" });
    }
    const symbol = parseWatchlistSymbol({ value: params.symbol });
    if (!symbol) {
      return reply.code(404).send(emptyCandles({ symbol: params.symbol, timeframe }));
    }
    if (!(await pingDatabase())) {
      return emptyCandles({ symbol, timeframe });
    }
    return readCandles({
      db: dbPair.db,
      redis,
      symbol,
      timeframe,
      from: from.date,
      to: to.date,
    });
  });

  app.get("/markets/:symbol/context", async (request, reply) => {
    const params = request.params as { symbol: string };
    const symbol = parseWatchlistSymbol({ value: params.symbol });
    if (!symbol) {
      return reply.code(404).send({
        available: false,
        symbol: params.symbol,
        quote: null,
        timeframes: {
          "15m": { currentCandle: null, lastFinalCandle: null, indicators: null },
          "1h": { currentCandle: null, lastFinalCandle: null, indicators: null },
          "4h": { currentCandle: null, lastFinalCandle: null, indicators: null },
        },
      });
    }
    if (!(await pingDatabase()) || !(await pingRedis())) {
      return {
        available: false,
        symbol,
        quote: null,
        timeframes: {
          "15m": { currentCandle: null, lastFinalCandle: null, indicators: null },
          "1h": { currentCandle: null, lastFinalCandle: null, indicators: null },
          "4h": { currentCandle: null, lastFinalCandle: null, indicators: null },
        },
      };
    }
    return readMarketContext({
      db: dbPair.db,
      redis,
      symbol,
      staleAfterMs: env.STALE_TICK_MS,
    });
  });

  app.get("/markets/:symbol", async (request, reply) => {
    const params = request.params as { symbol: string };
    const symbol = parseWatchlistSymbol({ value: params.symbol });
    if (!symbol) {
      return reply.code(404).send({ symbol: params.symbol });
    }
    const markets = (await pingRedis()) ? await readMarkets(redis, env.STALE_TICK_MS) : disconnectedMarkets();
    return markets.markets.find((item) => item.symbol === symbol) ?? { symbol };
  });

  app.get("/account", async () => {
    if (!(await pingRedis())) {
      return emptyAccount();
    }
    return readAccount(redis);
  });

  app.get("/stream", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    const write = async () => {
      const payload = (await pingRedis())
        ? await readMarkets(redis, env.STALE_TICK_MS)
        : disconnectedMarkets();
      reply.raw.write(`data: ${JSON.stringify({ type: "markets", payload })}\n\n`);
    };

    await write();
    const timer = setInterval(() => {
      void write();
    }, 2000);
    request.raw.on("close", () => {
      clearInterval(timer);
    });
  });

  app.addHook("onClose", async () => {
    redis.disconnect();
    await dbPair.client.end({ timeout: 2 }).catch(() => undefined);
  });

  return { app, env, redis };
}
