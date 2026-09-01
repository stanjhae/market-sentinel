import { hasEtoroCredentials, type Env } from "@market-sentinel/config";
import { REDIS_KEYS } from "@market-sentinel/contracts";
import { createDb, instruments, auditLogs, accountSnapshots } from "@market-sentinel/db";
import {
  TIMEFRAMES,
  WATCHLIST,
  shouldPublishStreamStatus,
  type CanonicalSymbol,
  type Timeframe,
} from "@market-sentinel/domain";
import { CandleBuilder, tickPrice } from "@market-sentinel/domain/candle";
import {
  EtoroMarketStream,
  EtoroRestClient,
  resolveWatchlistInstrument,
  type MarketTick,
} from "@market-sentinel/etoro-client";
import { createLogger } from "@market-sentinel/observability";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import {
  adoptCandleBuilder,
  backfillInstrument,
  persistIndicatorSnapshot,
  reconcileInstrument,
  upsertCandle,
  type InstrumentRef,
} from "./candle-store.js";
import { createSerialQueue } from "./serial-queue.js";
import { maybeAlertStreamStale, publishDomainEvent } from "./alert-store.js";
import { evaluateSignals } from "./signal-store.js";
import { evaluateStructure } from "./structure-store.js";

const logger = createLogger("worker");

export type QuoteRecord = {
  symbol: string;
  etoroInstrumentId: number | null;
  displayName: string | null;
  resolved: boolean;
  bid: string | null;
  ask: string | null;
  last: string | null;
  dailyChangePct: string | null;
  lastQuoteAt: string | null;
};

export async function startMarketWorker(env: Env): Promise<{ stop: () => Promise<void> }> {
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  redis.on("error", (error) => {
    logger.warn({ err: error }, "redis error");
  });
  try {
    await redis.connect();
  } catch (error) {
    logger.error({ err: error }, "redis unavailable; worker staying idle");
    redis.disconnect();
    return {
      stop: async () => undefined,
    };
  }

  if (!hasEtoroCredentials(env) || !env.ETORO_API_KEY || !env.ETORO_USER_KEY) {
    logger.info("eToro credentials missing; worker idle");
    await redis.set(
      REDIS_KEYS.stream,
      JSON.stringify({ streamStatus: "DISCONNECTED", lastQuoteAt: null, reconnectCount: 0 }),
    );
    return {
      stop: async () => {
        redis.disconnect();
      },
    };
  }

  const rest = new EtoroRestClient({
    apiKey: env.ETORO_API_KEY,
    userKey: env.ETORO_USER_KEY,
    accountType: env.ETORO_ACCOUNT_TYPE,
    restBaseUrl: env.ETORO_REST_BASE_URL,
    wsUrl: env.ETORO_WS_URL,
    staleAfterMs: env.STALE_TICK_MS,
  });

  const dbPair = createDb(env.DATABASE_URL);
  const resolvedIds: number[] = [];
  const idToSymbol = new Map<number, CanonicalSymbol>();
  const instrumentsBySymbol = new Map<CanonicalSymbol, InstrumentRef>();
  const builders = new Map<string, CandleBuilder>();
  const writeQueues = new Map<CanonicalSymbol, ReturnType<typeof createSerialQueue>>();
  const telegram = { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID };
  let previousStreamStatus: string | null = null;

  for (const symbol of WATCHLIST) {
    const result = await resolveWatchlistInstrument({ client: rest, symbol });
    const quote: QuoteRecord = {
      symbol,
      etoroInstrumentId: result.instrument?.instrumentId ?? null,
      displayName: result.instrument?.displayname ?? null,
      resolved: result.resolved,
      bid: null,
      ask: null,
      last: null,
      dailyChangePct:
        result.instrument?.dailyPriceChange === undefined
          ? null
          : String(result.instrument.dailyPriceChange),
      lastQuoteAt: null,
    };
    await redis.set(REDIS_KEYS.quote(symbol), JSON.stringify(quote));
    await dbPair.db
      .insert(instruments)
      .values({
        id: randomUUID(),
        etoroInstrumentId: result.instrument?.instrumentId ?? null,
        canonicalSymbol: symbol,
        displayName: result.instrument?.displayname ?? symbol,
        assetClass: result.instrument?.internalAssetClassName ?? null,
        enabled: result.resolved,
        metadataJson: result,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: instruments.canonicalSymbol,
        set: {
          etoroInstrumentId: result.instrument?.instrumentId ?? null,
          displayName: result.instrument?.displayname ?? symbol,
          enabled: result.resolved,
          metadataJson: result,
          updatedAt: new Date(),
        },
      })
      .catch((error: unknown) => {
        logger.warn({ err: error, symbol }, "instrument persist skipped");
      });

    if (result.resolved && result.instrument) {
      resolvedIds.push(result.instrument.instrumentId);
      idToSymbol.set(result.instrument.instrumentId, symbol);
      const persisted = await dbPair.db
        .select()
        .from(instruments)
        .where(eq(instruments.canonicalSymbol, symbol))
        .limit(1)
        .catch(() => []);
      const row = persisted[0];
      if (row) {
        instrumentsBySymbol.set(symbol, {
          id: row.id,
          symbol,
          etoroInstrumentId: result.instrument.instrumentId,
        });
      }
    } else {
      logger.warn({ symbol, ambiguous: result.ambiguous }, "watchlist instrument unresolved");
    }
  }

  await dbPair.db
    .insert(auditLogs)
    .values({
      id: randomUUID(),
      eventType: "INSTRUMENT_BOOTSTRAP",
      payloadJson: { resolvedIds },
    })
    .catch((error: unknown) => {
      logger.warn({ err: error }, "audit persist skipped");
    });

  const stream = new EtoroMarketStream(
    {
      apiKey: env.ETORO_API_KEY,
      userKey: env.ETORO_USER_KEY,
      accountType: env.ETORO_ACCOUNT_TYPE,
      restBaseUrl: env.ETORO_REST_BASE_URL,
      wsUrl: env.ETORO_WS_URL,
      staleAfterMs: env.STALE_TICK_MS,
    },
    {
      onTick: (tick: MarketTick) => {
        void persistTick({ redis, tick, idToSymbol });
        const symbol = idToSymbol.get(tick.instrumentId);
        if (!symbol) {
          return;
        }
        let queue = writeQueues.get(symbol);
        if (!queue) {
          queue = createSerialQueue();
          writeQueues.set(symbol, queue);
        }
        void queue.enqueue({
          task: () =>
            applyTickToBuilders({
              db: dbPair.db,
              redis,
              tick,
              idToSymbol,
              instrumentsBySymbol,
              builders,
              staleAfterMs: env.STALE_TICK_MS,
              telegram,
            }),
        });
      },
      onStatus: (status) => {
        const streamStatus = mapStatus(status);
        void (async () => {
          await redis.set(
            REDIS_KEYS.stream,
            JSON.stringify({
              streamStatus,
              lastQuoteAt: stream.getLastEventAt()?.toISOString() ?? null,
              reconnectCount: stream.getReconnectCount(),
            }),
          );
          if (shouldPublishStreamStatus({ previousStatus: previousStreamStatus, nextStatus: streamStatus })) {
            await publishDomainEvent({
              redis,
              event: {
                type: "stream",
                payload: {
                  streamStatus,
                  lastQuoteAt: stream.getLastEventAt()?.toISOString() ?? null,
                },
              },
            });
          }
          await maybeAlertStreamStale({
            context: { db: dbPair.db, redis, telegram },
            nextStatus: streamStatus,
          });
          previousStreamStatus = streamStatus;
        })();
      },
    },
  );

  const syncAccount = async () => {
    try {
      const { data } = await rest.getAggregatedPortfolio();
      const snapshot = {
        available: true,
        accountType: env.ETORO_ACCOUNT_TYPE === "demo" ? "DEMO" : "REAL",
        equity: data.accountTotals?.accountTotalValue?.toString() ?? null,
        cash: data.accountTotals?.accountBalance?.toString() ?? null,
        availableCash: data.accountTotals?.accountAvailableCash?.toString() ?? null,
        invested: data.accountTotals?.accountTotalUsedMargin?.toString() ?? null,
        unrealizedPnl: data.accountTotals?.accountCurrentPnl?.toString() ?? null,
        capturedAt: data.timestamp ?? new Date().toISOString(),
      };
      await redis.set(REDIS_KEYS.account, JSON.stringify(snapshot));
      await dbPair.db
        .insert(accountSnapshots)
        .values({
          id: randomUUID(),
          timestamp: new Date(snapshot.capturedAt),
          accountType: snapshot.accountType,
          equity: snapshot.equity,
          cash: snapshot.cash,
          availableCash: snapshot.availableCash,
          invested: snapshot.invested,
          unrealizedPnl: snapshot.unrealizedPnl,
          rawPayloadJson: data,
        })
        .catch((error: unknown) => {
          logger.warn({ err: error }, "account snapshot persist skipped");
        });
    } catch (error) {
      logger.warn({ err: error }, "account sync failed");
    }
  };

  const backfill = async () => {
    for (const instrument of instrumentsBySymbol.values()) {
      try {
        const created = await backfillInstrument({
          db: dbPair.db,
          redis,
          rest,
          instrument,
          telegram,
        });
        await evaluateSignals({
          db: dbPair.db,
          redis,
          instrument,
          staleAfterMs: env.STALE_TICK_MS,
          streamGate: "historical",
          telegram,
        });
        for (const timeframe of TIMEFRAMES) {
          const builder = created.get(timeframe);
          if (builder) {
            adoptCandleBuilder({
              builders,
              key: builderKey({ symbol: instrument.symbol, timeframe }),
              incoming: builder,
            });
          }
        }
        logger.info({ symbol: instrument.symbol }, "candle backfill complete");
      } catch (error) {
        logger.warn({ err: error, symbol: instrument.symbol }, "candle backfill failed");
      }
    }
  };

  const reconcile = async () => {
    for (const instrument of instrumentsBySymbol.values()) {
      try {
        const revisions = await reconcileInstrument({
          db: dbPair.db,
          redis,
          rest,
          instrument,
          telegram,
        });
        await evaluateSignals({
          db: dbPair.db,
          redis,
          instrument,
          staleAfterMs: env.STALE_TICK_MS,
          telegram,
        });
        if (revisions > 0) {
          logger.info({ symbol: instrument.symbol, revisions }, "REST candle reconcile revised finals");
        }
      } catch (error) {
        logger.warn({ err: error, symbol: instrument.symbol }, "candle reconcile failed");
      }
    }
  };

  await redis.set(
    REDIS_KEYS.stream,
    JSON.stringify({ streamStatus: "DELAYED", lastQuoteAt: null, reconnectCount: 0 }),
  );

  void syncAccount();
  await backfill();
  if (resolvedIds.length > 0) {
    stream.start(resolvedIds);
  }
  const accountTimer = setInterval(() => {
    void syncAccount();
  }, 60_000);
  const reconcileTimer = setInterval(() => {
    void reconcile();
  }, 120_000);

  return {
    stop: async () => {
      clearInterval(accountTimer);
      clearInterval(reconcileTimer);
      stream.stop();
      await dbPair.client.end({ timeout: 2 }).catch(() => undefined);
      redis.disconnect();
    },
  };
}

function builderKey(args: { symbol: CanonicalSymbol; timeframe: Timeframe }) {
  return `${args.symbol}:${args.timeframe}`;
}

async function applyTickToBuilders(args: {
  db: ReturnType<typeof createDb>["db"];
  redis: Redis;
  tick: MarketTick;
  idToSymbol: Map<number, CanonicalSymbol>;
  instrumentsBySymbol: Map<CanonicalSymbol, InstrumentRef>;
  builders: Map<string, CandleBuilder>;
  staleAfterMs: number;
  telegram?: { botToken?: string; chatId?: string };
}) {
  const symbol = args.idToSymbol.get(args.tick.instrumentId);
  if (!symbol) {
    return;
  }
  const instrument = args.instrumentsBySymbol.get(symbol);
  const price = tickPrice({ last: args.tick.last, bid: args.tick.bid, ask: args.tick.ask });
  if (!instrument || !price) {
    return;
  }
  const at = new Date(args.tick.quotedAt);
  let closedAny = false;
  for (const timeframe of TIMEFRAMES) {
    const key = builderKey({ symbol, timeframe });
    let builder = args.builders.get(key);
    if (!builder) {
      builder = new CandleBuilder({
        instrumentId: instrument.id,
        timeframe,
      });
      args.builders.set(key, builder);
    }
    try {
      const { updated, closed } = builder.applyTick({ price, at });
      await upsertCandle({ db: args.db, redis: args.redis, symbol, incoming: updated });
      if (closed) {
        await upsertCandle({ db: args.db, redis: args.redis, symbol, incoming: closed });
        await persistIndicatorSnapshot({
          db: args.db,
          redis: args.redis,
          symbol,
          instrumentId: instrument.id,
          timeframe,
        });
        await evaluateStructure({
          db: args.db,
          redis: args.redis,
          instrument,
          timeframe,
          streamGate: "live",
          telegram: args.telegram,
        });
        closedAny = true;
      }
    } catch (error) {
      logger.warn({ err: error, symbol, timeframe }, "live candle update failed");
    }
  }
  if (closedAny) {
    try {
      await evaluateSignals({
        db: args.db,
        redis: args.redis,
        instrument,
        staleAfterMs: args.staleAfterMs,
        telegram: args.telegram,
      });
    } catch (error) {
      logger.warn({ err: error, symbol }, "signal evaluation failed");
    }
  }
}

async function persistTick(args: {
  redis: Redis;
  tick: MarketTick;
  idToSymbol: Map<number, CanonicalSymbol>;
}) {
  const symbol = args.idToSymbol.get(args.tick.instrumentId);
  if (!symbol) {
    return;
  }
  const key = REDIS_KEYS.quote(symbol);
  const existingRaw = await args.redis.get(key);
  const existing = existingRaw ? (JSON.parse(existingRaw) as QuoteRecord) : null;
  const next: QuoteRecord = {
    symbol,
    etoroInstrumentId: args.tick.instrumentId,
    displayName: existing?.displayName ?? null,
    resolved: true,
    bid: args.tick.bid,
    ask: args.tick.ask,
    last: args.tick.last,
    dailyChangePct: existing?.dailyChangePct ?? null,
    lastQuoteAt: args.tick.quotedAt,
  };
  await args.redis.set(key, JSON.stringify(next));
  await args.redis.publish(REDIS_KEYS.ticksChannel, JSON.stringify(next));
  await args.redis.set(
    REDIS_KEYS.stream,
    JSON.stringify({
      streamStatus: "LIVE",
      lastQuoteAt: args.tick.quotedAt,
    }),
  );
}

function mapStatus(status: string) {
  if (status === "LIVE") return "LIVE";
  if (status === "STALE") return "STALE";
  if (status === "RECONNECTING" || status === "CONNECTING") return "DELAYED";
  return "DISCONNECTED";
}
