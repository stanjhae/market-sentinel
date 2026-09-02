import type { AlertDto } from "@market-sentinel/contracts";
import { REDIS_KEYS } from "@market-sentinel/contracts";
import { alerts, appSettings, auditLogs, type Database } from "@market-sentinel/db";
import {
  alertDedupeKey,
  alertHeadline,
  alertSendDecision,
  DEFAULT_ALERT_SETTINGS,
  entryStatusFromState,
  formatAlertCopy,
  mapSignalTransitionToAlert,
  mapZoneBreakToAlert,
  mergeAlertSettings,
  scoreCrossedWatch,
  shouldAlertStreamStale,
  shouldEmitAlert,
  type AlertChannel,
  type AlertSettings,
  type AlertType,
  type Location,
  type SignalState,
  type ZoneStatus,
} from "@market-sentinel/domain";
import { createLogger } from "@market-sentinel/observability";
import type { SignalRecord } from "@market-sentinel/strategies";
import type { PriceZone } from "@market-sentinel/market-structure";
import { and, desc, eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import type { InstrumentRef } from "./candle-store.js";

const logger = createLogger("worker-alerts");

export type TelegramCredentials = {
  botToken?: string;
  chatId?: string;
};

export type AlertDispatchContext = {
  db: Database;
  redis: Redis;
  streamGate: "live" | "historical";
  telegram?: TelegramCredentials;
  now?: Date;
};

export function telegramMessage(args: { title: string; body: string }): string {
  return `${args.title}\n\n${args.body}`;
}

export async function sendTelegramAlert(args: {
  telegram?: TelegramCredentials;
  title: string;
  body: string;
}): Promise<"sent" | "skipped" | "failed"> {
  const token = args.telegram?.botToken;
  const chatId = args.telegram?.chatId;
  if (!token || !chatId) {
    return "skipped";
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: telegramMessage({ title: args.title, body: args.body }),
      }),
    });
    if (!response.ok) {
      return "failed";
    }
    return "sent";
  } catch {
    return "failed";
  }
}

export async function loadAlertSettings(args: { db: Database }): Promise<AlertSettings> {
  try {
    const rows = await args.db.select().from(appSettings).where(eq(appSettings.id, "default")).limit(1);
    return mergeAlertSettings({ raw: rows[0]?.alertsJson ?? DEFAULT_ALERT_SETTINGS });
  } catch {
    return DEFAULT_ALERT_SETTINGS;
  }
}

export async function publishDomainEvent(args: {
  redis: Redis;
  event: { type: "signal" | "alert" | "stream"; payload: unknown };
}): Promise<void> {
  await args.redis.publish(REDIS_KEYS.eventsChannel, JSON.stringify(args.event));
}

export async function publishSignalChanged(args: {
  redis: Redis;
  record: Pick<SignalRecord, "id" | "instrumentId" | "symbol" | "state" | "score">;
}): Promise<void> {
  await publishDomainEvent({
    redis: args.redis,
    event: {
      type: "signal",
      payload: {
        id: args.record.id,
        instrumentId: args.record.instrumentId,
        symbol: args.record.symbol,
        state: args.record.state,
        score: args.record.score,
      },
    },
  });
}

export async function maybeAlertSignalTransition(args: {
  context: AlertDispatchContext;
  instrument: InstrumentRef;
  previousState: SignalState | null;
  next: SignalRecord;
}): Promise<void> {
  const type = mapSignalTransitionToAlert({
    previousState: args.previousState,
    nextState: args.next.state,
    strategyKey: args.next.strategyKey,
  });
  if (!shouldEmitAlert({ streamGate: args.context.streamGate, type })) {
    return;
  }
  const copy = copyFromSignal({ record: args.next, type: type as AlertType });
  await tryCreateAlert({
    context: args.context,
    type: type as AlertType,
    instrument: args.instrument,
    symbol: args.next.symbol,
    signalId: args.next.id,
    zoneId: null,
    subjectId: args.next.id,
    qualifier: args.next.state,
    score: args.next.score,
    direction: args.next.direction,
    state: args.next.state,
    title: copy.title,
    body: copy.body,
  });
}

export async function maybeAlertScoreCross(args: {
  context: AlertDispatchContext;
  instrument: InstrumentRef;
  previousScore: number | null;
  nextScore: number | null;
  record: SignalRecord | null;
  evaluatedOpenTimeUtc: Date;
}): Promise<void> {
  if (args.nextScore === null || !args.record) {
    return;
  }
  const settings = await loadAlertSettings({ db: args.context.db });
  if (
    !scoreCrossedWatch({
      previousScore: args.previousScore,
      nextScore: args.nextScore,
      threshold: settings.scoreThreshold,
      delta: settings.scoreDelta,
    })
  ) {
    return;
  }
  if (!shouldEmitAlert({ streamGate: args.context.streamGate, type: "WATCHLIST_OPPORTUNITY" })) {
    return;
  }
  const copy = copyFromSignal({ record: args.record, type: "WATCHLIST_OPPORTUNITY" });
  await tryCreateAlert({
    context: args.context,
    type: "WATCHLIST_OPPORTUNITY",
    instrument: args.instrument,
    symbol: args.instrument.symbol,
    signalId: args.record.id,
    zoneId: null,
    subjectId: "score",
    qualifier: `Watch:${args.evaluatedOpenTimeUtc.toISOString()}`,
    score: args.nextScore,
    direction: args.record.direction,
    state: args.record.state,
    title: copy.title,
    body: copy.body,
    settings,
  });
}

export async function maybeAlertZoneTransitions(args: {
  context: AlertDispatchContext;
  instrument: InstrumentRef;
  previous: PriceZone[];
  next: PriceZone[];
}): Promise<void> {
  const previousById = new Map(args.previous.filter((zone) => zone.id).map((zone) => [zone.id as string, zone]));
  for (const zone of args.next) {
    if (!zone.id) {
      continue;
    }
    const before = previousById.get(zone.id);
    if (!before) {
      continue;
    }
    const type = mapZoneBreakToAlert({
      previousStatus: before.status as ZoneStatus,
      nextStatus: zone.status as ZoneStatus,
    });
    if (!shouldEmitAlert({ streamGate: args.context.streamGate, type })) {
      continue;
    }
    const copy = formatAlertCopy({
      symbol: args.instrument.symbol,
      direction: null,
      headline: alertHeadline({ type: "PRICE_ZONE_BROKEN" }),
      score: null,
      timing: `${zone.type} ${zone.lowerBound}-${zone.upperBound} broke on a close beyond the zone.`,
      nextLevel: typeof zone.metadataJson.lastReaction === "string" ? zone.metadataJson.lastReaction : null,
    });
    await tryCreateAlert({
      context: args.context,
      type: "PRICE_ZONE_BROKEN",
      instrument: args.instrument,
      symbol: args.instrument.symbol,
      signalId: null,
      zoneId: zone.id,
      subjectId: zone.id,
      qualifier: `BROKEN:${zone.lastTouchedAt?.toISOString() ?? "now"}`,
      score: null,
      direction: null,
      state: zone.status,
      title: copy.title,
      body: copy.body,
    });
  }
}

export async function maybeAlertMajorLevel(args: {
  context: AlertDispatchContext;
  instrument: InstrumentRef;
  previousLocation: Location | null;
  nextLocation: Location;
  nearestZone: PriceZone | null;
  evaluatedOpenTimeUtc: Date;
}): Promise<void> {
  if (args.nextLocation !== "AT_SUPPORT" && args.nextLocation !== "AT_RESISTANCE") {
    return;
  }
  if (args.previousLocation === args.nextLocation) {
    return;
  }
  if (!args.nearestZone || args.nearestZone.strengthScore < 40 || !args.nearestZone.id) {
    return;
  }
  if (!shouldEmitAlert({ streamGate: args.context.streamGate, type: "MAJOR_LEVEL_APPROACHING" })) {
    return;
  }
  const copy = formatAlertCopy({
    symbol: args.instrument.symbol,
    direction: null,
    headline: alertHeadline({ type: "MAJOR_LEVEL_APPROACHING" }),
    score: null,
    timing: `Price is ${args.nextLocation === "AT_SUPPORT" ? "at support" : "at resistance"} ${args.nearestZone.lowerBound}-${args.nearestZone.upperBound}.`,
  });
  await tryCreateAlert({
    context: args.context,
    type: "MAJOR_LEVEL_APPROACHING",
    instrument: args.instrument,
    symbol: args.instrument.symbol,
    signalId: null,
    zoneId: args.nearestZone.id,
    subjectId: args.nearestZone.id,
    qualifier: `${args.nextLocation}:${args.evaluatedOpenTimeUtc.toISOString()}`,
    score: null,
    direction: null,
    state: args.nextLocation,
    title: copy.title,
    body: copy.body,
  });
}

export async function maybeAlertStreamStale(args: {
  context: Omit<AlertDispatchContext, "streamGate"> & { streamGate?: "live" | "historical" };
  nextStatus: string;
}): Promise<void> {
  const context: AlertDispatchContext = { ...args.context, streamGate: args.context.streamGate ?? "live" };
  const existing = await context.redis.get(REDIS_KEYS.streamStaleEpisode).catch(() => null);
  const decision = shouldAlertStreamStale({ episodeActive: existing !== null, nextStatus: args.nextStatus });
  if (!decision.episodeActive) {
    await context.redis.del(REDIS_KEYS.streamStaleEpisode).catch(() => undefined);
  }
  if (!decision.emit) {
    return;
  }
  if (!shouldEmitAlert({ streamGate: context.streamGate, type: "STREAM_STALE" })) {
    return;
  }
  const now = context.now ?? new Date();
  const episodeStartedAt = now.toISOString();
  const claimed = await context.redis.set(REDIS_KEYS.streamStaleEpisode, episodeStartedAt, "NX").catch(() => null);
  if (claimed !== "OK") {
    return;
  }
  const copy = formatAlertCopy({
    symbol: "STREAM",
    direction: null,
    headline: alertHeadline({ type: "STREAM_STALE" }),
    score: null,
    timing: "Market data is stale. Signal generation is frozen until the stream recovers.",
  });
  const created = await tryCreateAlert({
    context,
    type: "STREAM_STALE",
    instrument: { id: "stream", symbol: "US30", etoroInstrumentId: 0 },
    symbol: "STREAM",
    signalId: null,
    zoneId: null,
    subjectId: "stream",
    qualifier: episodeStartedAt,
    score: null,
    direction: null,
    state: "STALE",
    title: copy.title,
    body: copy.body,
  });
  if (!created) {
    await context.redis.del(REDIS_KEYS.streamStaleEpisode).catch(() => undefined);
  }
}

export async function readCachedScore(args: { redis: Redis; symbol: string }): Promise<number | null> {
  const raw = await args.redis.get(REDIS_KEYS.signals(args.symbol));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { opportunityScore?: number | null };
    return typeof parsed.opportunityScore === "number" ? parsed.opportunityScore : null;
  } catch {
    return null;
  }
}

async function tryCreateAlert(args: {
  context: AlertDispatchContext;
  type: AlertType;
  instrument: InstrumentRef;
  symbol: string;
  signalId: string | null;
  zoneId: string | null;
  subjectId: string;
  qualifier: string;
  score: number | null;
  direction: SignalRecord["direction"] | null;
  state: string | null;
  title: string;
  body: string;
  settings?: AlertSettings;
}): Promise<boolean> {
  const settings = args.settings ?? (await loadAlertSettings({ db: args.context.db }));
  const now = args.context.now ?? new Date();
  const last = await args.context.db
    .select()
    .from(alerts)
    .where(and(eq(alerts.symbol, args.symbol), eq(alerts.type, args.type)))
    .orderBy(desc(alerts.createdAt))
    .limit(1);
  if (
    alertSendDecision({
      settings,
      type: args.type,
      symbol: args.symbol,
      lastSentAt: last[0]?.createdAt ?? null,
      now,
    }) !== "send"
  ) {
    return false;
  }
  const dedupeKey = alertDedupeKey({
    type: args.type,
    instrumentId: args.instrument.id,
    subjectId: args.subjectId,
    qualifier: args.qualifier,
  });
  const channels: AlertChannel[] = ["in_app"];
  if (settings.browserEnabled) {
    channels.push("browser");
  }
  const telegramConfigured = Boolean(settings.telegramEnabled && args.context.telegram?.botToken && args.context.telegram.chatId);
  const id = randomUUID();
  try {
    const inserted = await args.context.db
      .insert(alerts)
      .values({
        id,
        type: args.type,
        instrumentId: args.instrument.id,
        symbol: args.symbol,
        signalId: args.signalId,
        zoneId: args.zoneId,
        title: args.title,
        body: args.body,
        score: args.score,
        direction: args.direction,
        state: args.state,
        dedupeKey,
        channelsJson: channels,
        createdAt: now,
      })
      .onConflictDoNothing({ target: alerts.dedupeKey })
      .returning({ id: alerts.id });
    if (inserted.length === 0) {
      return false;
    }
  } catch (error) {
    if (isUniqueViolation({ error })) {
      return false;
    }
    logger.warn({ err: error, type: args.type, symbol: args.symbol }, "alert persist skipped");
    return false;
  }
  try {
    await args.context.db.insert(auditLogs).values({
      id: randomUUID(),
      eventType: "ALERT_TRIGGERED",
      instrumentId: args.instrument.id,
      payloadJson: { alertId: id, type: args.type, symbol: args.symbol, dedupeKey },
    });
  } catch (error) {
    logger.warn({ err: error, alertId: id }, "alert audit skipped");
  }
  if (telegramConfigured) {
    const result = await sendTelegramAlert({
      telegram: args.context.telegram,
      title: args.title,
      body: args.body,
    });
    if (result === "sent") {
      channels.push("telegram");
      await args.context.db
        .update(alerts)
        .set({ channelsJson: channels })
        .where(eq(alerts.id, id))
        .catch((error: unknown) => {
          logger.warn({ err: error, alertId: id }, "telegram channel persist skipped");
        });
    } else if (result === "failed") {
      logger.warn({ symbol: args.symbol, type: args.type }, "telegram send failed");
    }
  }
  const dto: AlertDto = {
    id,
    type: args.type,
    instrumentId: args.instrument.id,
    symbol: args.symbol,
    signalId: args.signalId,
    zoneId: args.zoneId,
    title: args.title,
    body: args.body,
    score: args.score,
    direction: args.direction,
    state: args.state,
    dedupeKey,
    channels,
    readAt: null,
    createdAt: now.toISOString(),
  };
  try {
    await publishDomainEvent({ redis: args.context.redis, event: { type: "alert", payload: dto } });
  } catch (error) {
    logger.warn({ err: error, alertId: id }, "alert event publish skipped");
  }
  return true;
}

function copyFromSignal(args: { record: SignalRecord; type: AlertType }): { title: string; body: string } {
  const evidence = args.record.evidenceJson;
  const reason = typeof evidence.reason === "string" ? `${evidence.reason}.` : `${args.record.strategyKey} ${args.record.direction.toLowerCase()}.`;
  return formatAlertCopy({
    symbol: args.record.symbol,
    direction: args.record.direction,
    headline: alertHeadline({ type: args.type }),
    score: args.record.score,
    context4h: reason,
    setup1h: `${args.record.strategyKey} @ ${args.record.strategyVersion}.`,
    timing:
      args.record.entryZoneLow && args.record.entryZoneHigh
        ? `Entry ${args.record.entryZoneLow}-${args.record.entryZoneHigh}.`
        : null,
    entryStatus: `${entryStatusFromState({ state: args.record.state })}.`,
    invalidation: args.record.invalidationPrice ? `Invalidation ${args.record.invalidationPrice}.` : null,
    nextLevel: args.record.target1 ? `Next target ${args.record.target1}.` : null,
  });
}

function isUniqueViolation(args: { error: unknown }): boolean {
  return readErrorCode({ error: args.error }) === "23505";
}

function readErrorCode(args: { error: unknown }): string | null {
  if (typeof args.error !== "object" || args.error === null) {
    return null;
  }
  if ("code" in args.error && typeof args.error.code === "string") {
    return args.error.code;
  }
  if ("cause" in args.error) {
    return readErrorCode({ error: args.error.cause });
  }
  return null;
}
