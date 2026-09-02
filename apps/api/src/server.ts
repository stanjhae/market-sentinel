import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { hasEtoroCredentials, hasTelegramCredentials, type Env } from "@market-sentinel/config";
import { EtoroDemoExecutionClient } from "@market-sentinel/etoro-client";
import { psychologyChecklistSchema, REDIS_KEYS, sseEventSchema } from "@market-sentinel/contracts";
import { createDb } from "@market-sentinel/db";
import { parseEventTimeUtc, parseWatchlistSymbol, RISK_DEFAULTS } from "@market-sentinel/domain";
import Fastify from "fastify";
import { Redis } from "ioredis";
import {
  countUnreadAlerts,
  emptyAlerts,
  markAlertRead,
  markAllAlertsRead,
  parseStreamSnapshot,
  publishUnreadSnapshot,
  readAlerts,
} from "./alerts.js";
import { emptyCandles, emptyContext, parseIsoDateQuery, parseTimeframeQuery, readCandles, readMarketContext } from "./candles.js";
import {
  allowedBrowserOrigins,
  clearLoginFailures,
  clearSessionCookieHeader,
  isAllowedBrowserOrigin,
  isPublicRoute,
  loginLockStatus,
  passwordsMatch,
  readSessionCookie,
  recordLoginFailure,
  requestIsHttps,
  sessionCookieHeader,
  SESSION_TTL_MS,
  signSession,
  verifySession,
} from "./auth.js";
import { loadApiEnv } from "./env.js";
import { composeReady } from "./health.js";
import { emptyHistory, emptyPositions, readAccountSnapshot, readHistory, readPositions } from "./account.js";
import { createEvent, deleteEvent, emptyEvents, readEvents } from "./events.js";
import { disconnectedMarkets, emptyAccount, readAccount, readMarkets } from "./markets.js";
import { emptyRiskStatus, evaluateStoredPlan, readRiskStatus, setManualCooldown } from "./risk.js";
import { emptySettings, patchAlertSettings, patchJsonBucket, readSettings } from "./settings.js";
import { createManualZone, deleteManualZone, emptyZones, parseManualZoneBody, readZones, updateManualZone } from "./zones.js";
import { createApprovedPlan, dismissStoredSignal, emptySignalDetail, emptySignals, parseSignalFilters, readSignal, readSignals } from "./signals.js";
import {
  emptyJournal,
  emptyJournalDetail,
  parseJournalPatch,
  patchJournal,
  readJournal,
  readJournalDetail,
  readJournalScreenshot,
  saveJournalScreenshot,
} from "./journal.js";
import {
  emptyAnalyticsSummary,
  readAnalyticsInstruments,
  readAnalyticsPsychology,
  readAnalyticsSetups,
  readAnalyticsSummary,
} from "./analytics.js";
import {
  confirmClose,
  confirmOpen,
  executionStatusFromEnv,
  previewClose,
  previewOpen,
} from "./execution.js";
import {
  addPaperTrade,
  createBacktestRun,
  emptyBacktestRun,
  emptyBacktestTrades,
  emptyReplayFrame,
  parseCreateBacktest,
  parseCreateReplay,
  parsePaperTrade,
  readBacktestRun,
  readBacktestTrades,
  readReplayFrame,
} from "./backtest.js";

export async function buildServer(args: { env?: Partial<Env>; executionClient?: EtoroDemoExecutionClient | null } = {}) {
  const loaded = loadApiEnv();
  const env = {
    ...loaded,
    ...(process.env.NODE_ENV === "test" ? { APP_PASSWORD: undefined } : {}),
    ...args.env,
  };
  const app = Fastify({ logger: false });
  const browserOrigins = allowedBrowserOrigins({ webPort: env.WEB_PORT });
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || browserOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"],
  });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
  app.addHook("onRequest", async (request, reply) => {
    if (isPublicRoute({ url: request.url, method: request.method })) {
      return;
    }
    if (!env.APP_PASSWORD) {
      return;
    }
    const token = readSessionCookie({ header: request.headers.cookie });
    if (!verifySession({ token, secret: env.APP_PASSWORD, now: Date.now() })) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redis.on("error", () => {
    // Connection failures are reflected in /health/ready and /markets.
  });
  const dbPair = createDb(env.DATABASE_URL);
  const executionClient =
    args.executionClient !== undefined
      ? args.executionClient
      : hasEtoroCredentials(env) && env.ETORO_API_KEY && env.ETORO_USER_KEY
        ? new EtoroDemoExecutionClient(
            {
              apiKey: env.ETORO_API_KEY,
              userKey: env.ETORO_USER_KEY,
              accountType: env.ETORO_ACCOUNT_TYPE,
              restBaseUrl: env.ETORO_REST_BASE_URL,
              wsUrl: env.ETORO_WS_URL,
            },
            { enabled: env.DEMO_EXECUTION_ENABLED },
          )
        : null;
  const executionDeps = () => ({
    db: dbPair.db,
    redis,
    env,
    client: executionClient,
    pnlWaitMs: process.env.NODE_ENV === "test" ? 0 : 10_000,
  });

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
      ready: composeReady({ checks }),
      checks,
    };
  });

  app.get("/auth/session", async (request) => {
    if (!env.APP_PASSWORD) {
      return { required: false, authenticated: true };
    }
    const token = readSessionCookie({ header: request.headers.cookie });
    return {
      required: true,
      authenticated: verifySession({ token, secret: env.APP_PASSWORD, now: Date.now() }),
    };
  });

  app.post("/auth/login", async (request, reply) => {
    const now = Date.now();
    const lock = loginLockStatus({ ip: request.ip, now });
    if (lock.locked) {
      reply.header("retry-after", String(lock.retryAfterSec));
      return reply.code(429).send({ error: "too-many-attempts" });
    }
    const body = request.body as { password?: unknown };
    const provided = typeof body?.password === "string" ? body.password : "";
    if (!env.APP_PASSWORD || !passwordsMatch({ provided, expected: env.APP_PASSWORD })) {
      const next = recordLoginFailure({ ip: request.ip, now });
      if (next.locked) {
        reply.header("retry-after", String(next.retryAfterSec));
        return reply.code(429).send({ error: "too-many-attempts" });
      }
      return reply.code(401).send({ error: "unauthorized" });
    }
    clearLoginFailures({ ip: request.ip });
    const token = signSession({ secret: env.APP_PASSWORD, now });
    const secure = requestIsHttps({
      protocol: request.protocol,
      forwardedProto: request.headers["x-forwarded-proto"],
    });
    reply.header("set-cookie", sessionCookieHeader({ token, maxAgeSec: SESSION_TTL_MS / 1000, secure }));
    return { required: true, authenticated: true };
  });

  app.post("/auth/logout", async (request, reply) => {
    const secure = requestIsHttps({
      protocol: request.protocol,
      forwardedProto: request.headers["x-forwarded-proto"],
    });
    reply.header("set-cookie", clearSessionCookieHeader({ secure }));
    return { required: Boolean(env.APP_PASSWORD), authenticated: false };
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
      return reply.code(404).send(emptyContext({ symbol: params.symbol }));
    }
    if (!(await pingDatabase()) || !(await pingRedis())) {
      return emptyContext({ symbol });
    }
    return readMarketContext({
      db: dbPair.db,
      redis,
      symbol,
      staleAfterMs: env.STALE_TICK_MS,
    });
  });

  app.get("/markets/:symbol/zones", async (request, reply) => {
    const params = request.params as { symbol: string };
    const symbol = parseWatchlistSymbol({ value: params.symbol });
    if (!symbol) {
      return reply.code(404).send(emptyZones({ symbol: params.symbol }));
    }
    if (!(await pingDatabase())) {
      return emptyZones({ symbol });
    }
    return readZones({ db: dbPair.db, symbol });
  });

  app.post("/markets/:symbol/zones", async (request, reply) => {
    const params = request.params as { symbol: string };
    const symbol = parseWatchlistSymbol({ value: params.symbol });
    if (!symbol) {
      return reply.code(404).send({ error: "unknown symbol" });
    }
    const parsed = parseManualZoneBody({ body: request.body });
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error });
    }
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const created = await createManualZone({ db: dbPair.db, redis, symbol, input: parsed.value });
    if (!created) {
      return reply.code(404).send({ error: "instrument not bootstrapped" });
    }
    return reply.code(201).send(created);
  });

  app.patch("/markets/:symbol/zones/:id", async (request, reply) => {
    const params = request.params as { symbol: string; id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (body.type && body.type !== "SUPPORT" && body.type !== "RESISTANCE" && body.type !== "BOTH") {
      return reply.code(400).send({ error: "invalid type" });
    }
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const type = body.type === "SUPPORT" || body.type === "RESISTANCE" || body.type === "BOTH" ? body.type : undefined;
    const timeframe = body.timeframe === "15m" || body.timeframe === "1h" || body.timeframe === "4h" ? body.timeframe : undefined;
    const status =
      body.status === "ACTIVE" || body.status === "BROKEN" || body.status === "FLIPPED" || body.status === "EXPIRED"
        ? body.status
        : undefined;
    const updated = await updateManualZone({
      db: dbPair.db,
      redis,
      symbol: params.symbol,
      id: params.id,
      input: {
        type,
        timeframe,
        lowerBound: typeof body.lowerBound === "string" ? body.lowerBound : undefined,
        upperBound: typeof body.upperBound === "string" ? body.upperBound : undefined,
        midpoint: typeof body.midpoint === "string" ? body.midpoint : undefined,
        note: typeof body.note === "string" ? body.note : undefined,
        status,
      },
    });
    if (updated === "not_found") {
      return reply.code(404).send({ error: "zone not found" });
    }
    if (updated === "not_manual") {
      return reply.code(409).send({ error: "auto zones cannot be edited" });
    }
    if (updated === "invalid_bounds") {
      return reply.code(400).send({ error: "invalid bounds" });
    }
    return updated;
  });

  app.delete("/markets/:symbol/zones/:id", async (request, reply) => {
    const params = request.params as { symbol: string; id: string };
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const result = await deleteManualZone({ db: dbPair.db, redis, symbol: params.symbol, id: params.id });
    if (result === "not_found") {
      return reply.code(404).send({ error: "zone not found" });
    }
    if (result === "not_manual") {
      return reply.code(409).send({ error: "auto zones cannot be deleted" });
    }
    return reply.code(204).send();
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

  app.get("/signals", async (request) => {
    const query = request.query as Record<string, unknown>;
    if (!(await pingDatabase())) {
      return emptySignals();
    }
    return readSignals({ db: dbPair.db, redis, filters: parseSignalFilters({ query }) });
  });

  app.get("/signals/:id", async (request, reply) => {
    const params = request.params as { id: string };
    if (!(await pingDatabase())) {
      return emptySignalDetail();
    }
    const detail = await readSignal({ db: dbPair.db, id: params.id });
    if (!detail.signal) {
      return reply.code(404).send(detail);
    }
    return detail;
  });

  app.post("/signals/:id/dismiss", async (request, reply) => {
    const params = request.params as { id: string };
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const result = await dismissStoredSignal({ db: dbPair.db, redis, id: params.id });
    if (result === "not_found") {
      return reply.code(404).send({ error: "signal not found" });
    }
    if (result === "terminal") {
      return reply.code(409).send({ error: "signal already closed" });
    }
    const detail = await readSignal({ db: dbPair.db, id: params.id });
    if (detail.signal) {
      await redis.publish(
        REDIS_KEYS.eventsChannel,
        JSON.stringify({
          type: "signal",
          payload: {
            id: detail.signal.id,
            instrumentId: detail.signal.instrumentId,
            symbol: detail.signal.symbol,
            state: detail.signal.state,
            score: detail.signal.score,
          },
        }),
      );
    }
    return detail;
  });

  app.get("/alerts", async (request) => {
    const query = request.query as { unread?: string };
    if (!(await pingDatabase())) {
      return emptyAlerts();
    }
    try {
      return await readAlerts({ db: dbPair.db, redis, unreadOnly: query.unread === "true" });
    } catch {
      return emptyAlerts();
    }
  });

  app.post("/alerts/:id/read", async (request, reply) => {
    const params = request.params as { id: string };
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const result = await markAlertRead({ db: dbPair.db, id: params.id });
    if (result === "not_found") {
      return reply.code(404).send({ error: "alert not found" });
    }
    const unreadCount = await countUnreadAlerts({ db: dbPair.db });
    await publishUnreadSnapshot({ redis, unreadCount }).catch(() => undefined);
    return { ok: true as const };
  });

  app.post("/alerts/read-all", async (request, reply) => {
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const count = await markAllAlertsRead({ db: dbPair.db });
    const unreadCount = await countUnreadAlerts({ db: dbPair.db });
    await publishUnreadSnapshot({ redis, unreadCount }).catch(() => undefined);
    return { ok: true as const, count };
  });

  app.get("/settings", async () => {
    const telegramConfigured = hasTelegramCredentials({ env });
    if (!(await pingDatabase())) {
      return emptySettings({ telegramConfigured });
    }
    try {
      return await readSettings({ db: dbPair.db, telegramConfigured });
    } catch {
      return emptySettings({ telegramConfigured });
    }
  });

  app.patch("/settings/alerts", async (request, reply) => {
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const result = await patchAlertSettings({
      db: dbPair.db,
      telegramConfigured: hasTelegramCredentials({ env }),
      patch: request.body,
    });
    if (!result.ok) {
      return reply.code(400).send({ error: result.error });
    }
    return result.settings;
  });

  app.patch("/settings/risk", async (request, reply) => {
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const result = await patchJsonBucket({
      db: dbPair.db,
      telegramConfigured: hasTelegramCredentials({ env }),
      bucket: "risk",
      patch: request.body,
    });
    if (!result.ok) {
      return reply.code(400).send({ error: result.error });
    }
    return result.settings;
  });

  app.patch("/settings/markets", async (request, reply) => {
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const result = await patchJsonBucket({
      db: dbPair.db,
      telegramConfigured: hasTelegramCredentials({ env }),
      bucket: "markets",
      patch: request.body,
    });
    if (!result.ok) {
      return reply.code(400).send({ error: result.error });
    }
    return result.settings;
  });

  app.post("/signals/:id/create-plan", async (request, reply) => {
    const params = request.params as { id: string };
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const body = (request.body ?? {}) as {
      checklist?: unknown;
      riskPct?: string;
      logRejection?: boolean;
    };
    const checklist = body.checklist ? psychologyChecklistSchema.safeParse(body.checklist) : { success: true as const, data: null };
    if (!checklist.success) {
      return reply.code(400).send({ error: "invalid checklist" });
    }
    const result = await createApprovedPlan({
      db: dbPair.db,
      redis,
      id: params.id,
      checklist: checklist.data,
      riskPct: typeof body.riskPct === "string" ? body.riskPct : undefined,
      logRejection: body.logRejection === true,
    });
    if ("error" in result) {
      return reply.code(404).send({ error: "signal not found" });
    }
    if (result.status === "BLOCKED") {
      return reply.code(409).send(result);
    }
    return result;
  });

  app.get("/execution/status", async () => executionStatusFromEnv({ env }));

  app.post("/execution/preview", async (request, reply) => {
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const body = (request.body ?? {}) as { planId?: unknown; signalId?: unknown };
    const planId = typeof body.planId === "string" ? body.planId : undefined;
    const signalId = typeof body.signalId === "string" ? body.signalId : undefined;
    if (!planId && !signalId) {
      return reply.code(400).send({ error: "planId or signalId required" });
    }
    const result = await previewOpen({ ...executionDeps(), planId, signalId });
    return reply.code(result.http).send(result.body);
  });

  app.post("/execution/confirm", async (request, reply) => {
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const body = (request.body ?? {}) as { nonce?: unknown };
    if (typeof body.nonce !== "string" || body.nonce.length === 0) {
      return reply.code(409).send({ error: "invalid preview nonce" });
    }
    const result = await confirmOpen({ ...executionDeps(), nonce: body.nonce });
    return reply.code(result.http).send(result.body);
  });

  app.post("/execution/close/preview", async (request, reply) => {
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const body = (request.body ?? {}) as { positionId?: unknown };
    if (typeof body.positionId !== "string" || body.positionId.length === 0) {
      return reply.code(400).send({ error: "positionId required" });
    }
    const result = await previewClose({ ...executionDeps(), positionId: body.positionId });
    return reply.code(result.http).send(result.body);
  });

  app.post("/execution/close/confirm", async (request, reply) => {
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const body = (request.body ?? {}) as { nonce?: unknown };
    if (typeof body.nonce !== "string" || body.nonce.length === 0) {
      return reply.code(409).send({ error: "invalid preview nonce" });
    }
    const result = await confirmClose({ ...executionDeps(), nonce: body.nonce });
    return reply.code(result.http).send(result.body);
  });

  app.get("/account", async () => {
    if (!(await pingRedis())) {
      return emptyAccount();
    }
    return readAccount(redis);
  });

  app.get("/account/positions", async () => {
    if (!(await pingDatabase())) {
      return emptyPositions();
    }
    try {
      return await readPositions({ db: dbPair.db });
    } catch {
      return emptyPositions();
    }
  });

  app.get("/account/history", async () => {
    if (!(await pingDatabase())) {
      return emptyHistory();
    }
    try {
      const account = (await pingRedis()) ? await readAccountSnapshot({ redis }) : emptyAccount();
      return await readHistory({ db: dbPair.db, historyUnavailable: account.historyUnavailable });
    } catch {
      return emptyHistory();
    }
  });

  app.post("/account/sync", async () => {
    if (!(await pingRedis())) {
      return emptyAccount();
    }
    await redis.set(REDIS_KEYS.forceAccountSync, new Date().toISOString());
    return readAccount(redis);
  });

  app.get("/risk/status", async () => {
    if (!(await pingDatabase())) {
      return emptyRiskStatus();
    }
    try {
      return await readRiskStatus({ db: dbPair.db, redis });
    } catch {
      return emptyRiskStatus();
    }
  });

  app.post("/risk/evaluate-plan", async (request, reply) => {
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const body = request.body as {
      symbol?: string;
      direction?: "LONG" | "SHORT" | "NEUTRAL";
      plannedEntry?: string | null;
      stopLoss?: string | null;
      target1?: string | null;
      riskPct?: string | null;
      riskRewardToT1?: string | null;
    };
    const symbol = parseWatchlistSymbol({ value: body.symbol ?? "" });
    if (!symbol || !body.direction) {
      return reply.code(400).send({ error: "invalid plan" });
    }
    return evaluateStoredPlan({
      db: dbPair.db,
      plan: {
        symbol,
        direction: body.direction,
        plannedEntry: body.plannedEntry ?? null,
        stopLoss: body.stopLoss ?? null,
        target1: body.target1 ?? null,
        riskPct: body.riskPct ?? null,
        riskRewardToT1: body.riskRewardToT1 ?? null,
      },
    });
  });

  app.post("/risk/cooldown", async (request, reply) => {
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const body = request.body as { minutes?: number; until?: string };
    const until = body.until
      ? new Date(body.until)
      : new Date(Date.now() + (body.minutes ?? RISK_DEFAULTS.cooldownAfterLossMinutes) * 60 * 1000);
    if (Number.isNaN(until.getTime())) {
      return reply.code(400).send({ error: "invalid cooldown" });
    }
    await setManualCooldown({ db: dbPair.db, until });
    return readRiskStatus({ db: dbPair.db, redis });
  });

  app.get("/events", async () => {
    if (!(await pingDatabase())) {
      return emptyEvents();
    }
    try {
      return await readEvents({ db: dbPair.db });
    } catch {
      return emptyEvents();
    }
  });

  app.post("/events", async (request, reply) => {
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const body = request.body as {
      eventName?: string;
      currency?: string;
      impact?: "LOW" | "MEDIUM" | "HIGH";
      scheduledAtUtc?: string;
      blackoutBeforeMinutes?: number;
      blackoutAfterMinutes?: number;
    };
    if (!body.eventName || !body.currency || !body.scheduledAtUtc) {
      return reply.code(400).send({ error: "invalid event" });
    }
    const scheduledAtUtc = parseEventTimeUtc({ value: body.scheduledAtUtc });
    if (!scheduledAtUtc) {
      return reply.code(400).send({ error: "invalid event time" });
    }
    return createEvent({
      db: dbPair.db,
      eventName: body.eventName,
      currency: body.currency,
      impact: body.impact === "LOW" || body.impact === "MEDIUM" ? body.impact : "HIGH",
      scheduledAtUtc,
      blackoutBeforeMinutes: body.blackoutBeforeMinutes,
      blackoutAfterMinutes: body.blackoutAfterMinutes,
    });
  });

  app.get("/journal", async () => {
    if (!(await pingDatabase())) {
      return emptyJournal();
    }
    try {
      const account = (await pingRedis()) ? await readAccountSnapshot({ redis }) : emptyAccount();
      return await readJournal({ db: dbPair.db, historyUnavailable: account.historyUnavailable });
    } catch {
      return emptyJournal();
    }
  });

  app.get("/journal/:id", async (request, reply) => {
    const params = request.params as { id: string };
    if (!(await pingDatabase())) {
      return emptyJournalDetail();
    }
    const detail = await readJournalDetail({ db: dbPair.db, id: params.id });
    if (!detail.entry) {
      return reply.code(404).send(detail);
    }
    return detail;
  });

  app.patch("/journal/:id", async (request, reply) => {
    const params = request.params as { id: string };
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const parsed = parseJournalPatch({ body: request.body });
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error });
    }
    const result = await patchJournal({ db: dbPair.db, id: params.id, patch: parsed.value });
    if (result === "not_found") {
      return reply.code(404).send({ error: "journal entry not found" });
    }
    if (result === "invalid_plan") {
      return reply.code(400).send({ error: "trade plan is missing, not approved, or does not match this entry" });
    }
    if (result === "plan_in_use") {
      return reply.code(409).send({ error: "trade plan is already linked to another journal entry" });
    }
    return result;
  });

  app.post("/journal/:id/screenshot", async (request, reply) => {
    const params = request.params as { id: string };
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    let buffer: Buffer | null = null;
    if (request.isMultipart()) {
      const file = await request.file();
      if (file) {
        buffer = await file.toBuffer();
      }
    } else {
      const body = (request.body ?? {}) as { contentBase64?: string };
      if (typeof body.contentBase64 === "string") {
        buffer = Buffer.from(body.contentBase64, "base64");
      }
    }
    if (!buffer) {
      return reply.code(400).send({ error: "missing screenshot" });
    }
    const result = await saveJournalScreenshot({ db: dbPair.db, id: params.id, buffer });
    if (result === "not_found") {
      return reply.code(404).send({ error: "journal entry not found" });
    }
    if (result === "invalid") {
      return reply.code(400).send({ error: "invalid screenshot" });
    }
    return result;
  });

  app.get("/journal/:id/screenshot", async (request, reply) => {
    const params = request.params as { id: string };
    const file = await readJournalScreenshot({ db: dbPair.db, id: params.id });
    if (!file) {
      return reply.code(404).send({ error: "screenshot not found" });
    }
    return reply.type(file.contentType).send(file.buffer);
  });

  app.get("/analytics/summary", async () => {
    if (!(await pingDatabase())) {
      return emptyAnalyticsSummary();
    }
    try {
      return await readAnalyticsSummary({ db: dbPair.db });
    } catch {
      return emptyAnalyticsSummary();
    }
  });

  app.get("/analytics/setups", async () => {
    if (!(await pingDatabase())) {
      return { available: false, empty: true, setups: [] };
    }
    try {
      return await readAnalyticsSetups({ db: dbPair.db });
    } catch {
      return { available: false, empty: true, setups: [] };
    }
  });

  app.get("/analytics/instruments", async () => {
    if (!(await pingDatabase())) {
      return { available: false, empty: true, instruments: [] };
    }
    try {
      return await readAnalyticsInstruments({ db: dbPair.db });
    } catch {
      return { available: false, empty: true, instruments: [] };
    }
  });

  app.get("/analytics/psychology", async () => {
    if (!(await pingDatabase())) {
      return { available: false, empty: true, psychology: null };
    }
    try {
      return await readAnalyticsPsychology({ db: dbPair.db });
    } catch {
      return { available: false, empty: true, psychology: null };
    }
  });

  app.post("/backtests", async (request, reply) => {
    const body = parseCreateBacktest({ body: request.body });
    if (!body.ok) {
      return reply.code(400).send({ error: "invalid backtest request" });
    }
    if (!(await pingDatabase())) {
      return reply.code(503).send(emptyBacktestRun());
    }
    try {
      return await createBacktestRun({ db: dbPair.db, body: body.value, kind: "backtest" });
    } catch {
      return reply.code(503).send(emptyBacktestRun());
    }
  });

  app.get("/backtests/:id", async (request, reply) => {
    const params = request.params as { id: string };
    if (!(await pingDatabase())) {
      return emptyBacktestRun();
    }
    try {
      const result = await readBacktestRun({ db: dbPair.db, id: params.id });
      if (!result.run) {
        return reply.code(404).send(emptyBacktestRun());
      }
      return result;
    } catch {
      return emptyBacktestRun();
    }
  });

  app.get("/backtests/:id/trades", async (request) => {
    const params = request.params as { id: string };
    if (!(await pingDatabase())) {
      return emptyBacktestTrades();
    }
    try {
      return await readBacktestTrades({ db: dbPair.db, id: params.id });
    } catch {
      return emptyBacktestTrades();
    }
  });

  app.post("/replay/sessions", async (request, reply) => {
    const body = parseCreateReplay({ body: request.body });
    if (!body.ok) {
      return reply.code(400).send({ error: "invalid replay request" });
    }
    if (!(await pingDatabase())) {
      return reply.code(503).send(emptyBacktestRun());
    }
    try {
      return await createBacktestRun({ db: dbPair.db, body: body.value, kind: "replay" });
    } catch {
      return reply.code(503).send(emptyBacktestRun());
    }
  });

  app.get("/replay/sessions/:id/frame", async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { index?: string; timeframe?: string };
    const timeframe = parseTimeframeQuery({ value: query.timeframe });
    if (!timeframe) {
      return reply.code(400).send({ error: "invalid timeframe" });
    }
    const index = Number(query.index ?? "0");
    if (!Number.isInteger(index) || index < 0) {
      return reply.code(400).send({ error: "invalid index" });
    }
    if (!(await pingDatabase())) {
      return emptyReplayFrame({ sessionId: params.id, timeframe });
    }
    try {
      return await readReplayFrame({ db: dbPair.db, id: params.id, index, timeframe });
    } catch {
      return emptyReplayFrame({ sessionId: params.id, timeframe });
    }
  });

  app.post("/replay/sessions/:id/paper-trade", async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { index?: string };
    const body = parsePaperTrade({ body: request.body });
    if (!body.ok) {
      return reply.code(400).send({ error: "invalid paper trade" });
    }
    const index = Number(query.index ?? "0");
    if (!Number.isInteger(index) || index < 0) {
      return reply.code(400).send({ error: "invalid index" });
    }
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    try {
      const result = await addPaperTrade({ db: dbPair.db, id: params.id, index, body: body.value });
      if ("error" in result) {
        return reply.code(404).send({ error: "session not found" });
      }
      return result;
    } catch {
      return reply.code(503).send({ error: "paper trade failed" });
    }
  });

  app.delete("/events/:id", async (request, reply) => {
    const params = request.params as { id: string };
    if (!(await pingDatabase())) {
      return reply.code(503).send({ error: "database unavailable" });
    }
    const deleted = await deleteEvent({ db: dbPair.db, id: params.id });
    if (!deleted) {
      return reply.code(404).send({ error: "event not found" });
    }
    return readEvents({ db: dbPair.db });
  });

  app.get("/stream", async (request, reply) => {
    reply.hijack();
    const requestOrigin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
    const allowOrigin = isAllowedBrowserOrigin({ origin: requestOrigin, webPort: env.WEB_PORT })
      ? requestOrigin
      : (browserOrigins[0] ?? "http://localhost:3000");
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Credentials": "true",
    });

    const write = async () => {
      const payload = (await pingRedis())
        ? await readMarkets(redis, env.STALE_TICK_MS)
        : disconnectedMarkets();
      reply.raw.write(`data: ${JSON.stringify({ type: "markets", payload })}\n\n`);
    };

    await write();
    const unreadCount = (await pingDatabase())
      ? await countUnreadAlerts({ db: dbPair.db }).catch(() => 0)
      : 0;
    const stream = parseStreamSnapshot({
      raw: (await pingRedis()) ? await redis.get(REDIS_KEYS.stream).catch(() => null) : null,
    });
    reply.raw.write(
      `data: ${JSON.stringify({
        type: "stream",
        payload: {
          streamStatus: stream.streamStatus,
          lastQuoteAt: stream.lastQuoteAt,
          unreadCount,
        },
      })}\n\n`,
    );

    const subscriber = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    subscriber.on("error", () => {
      // Stream stays open; the 2s markets poll remains the fallback.
    });
    try {
      if (subscriber.status !== "ready") {
        await subscriber.connect();
      }
      await subscriber.subscribe(REDIS_KEYS.eventsChannel);
      subscriber.on("message", (_channel, message) => {
        try {
          const parsed = sseEventSchema.safeParse(JSON.parse(message));
          if (!parsed.success) {
            return;
          }
          reply.raw.write(`data: ${JSON.stringify(parsed.data)}\n\n`);
        } catch {
          // ignore malformed pub/sub frames
        }
      });
    } catch {
      subscriber.disconnect();
    }

    const timer = setInterval(() => {
      void write();
    }, 2000);
    request.raw.on("close", () => {
      clearInterval(timer);
      subscriber.disconnect();
    });
  });

  app.addHook("onClose", async () => {
    redis.disconnect();
    await dbPair.client.end({ timeout: 2 }).catch(() => undefined);
  });

  return { app, env, redis };
}
