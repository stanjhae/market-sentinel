import type { AlertDto, AlertsResponse } from "@market-sentinel/contracts";
import { REDIS_KEYS } from "@market-sentinel/contracts";
import { alerts, type Database } from "@market-sentinel/db";
import { parseAlertType, type AlertChannel, type SignalDirection } from "@market-sentinel/domain";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Redis } from "ioredis";

export const ALERTS_INBOX_LIMIT = 100;

export function emptyAlerts(): AlertsResponse {
  return { available: false, staleStream: false, unreadCount: 0, alerts: [] };
}

export function parseStreamSnapshot(args: { raw: string | null }): {
  streamStatus: "LIVE" | "DELAYED" | "STALE" | "DISCONNECTED";
  lastQuoteAt: string | null;
  stale: boolean;
} {
  if (!args.raw) {
    return { streamStatus: "DISCONNECTED", lastQuoteAt: null, stale: true };
  }
  try {
    const stream = JSON.parse(args.raw) as { streamStatus?: string; lastQuoteAt?: string | null };
    const streamStatus =
      stream.streamStatus === "LIVE" ||
      stream.streamStatus === "DELAYED" ||
      stream.streamStatus === "STALE" ||
      stream.streamStatus === "DISCONNECTED"
        ? stream.streamStatus
        : "DISCONNECTED";
    return {
      streamStatus,
      lastQuoteAt: typeof stream.lastQuoteAt === "string" ? stream.lastQuoteAt : null,
      stale: streamStatus === "STALE" || streamStatus === "DISCONNECTED",
    };
  } catch {
    return { streamStatus: "DISCONNECTED", lastQuoteAt: null, stale: false };
  }
}

export function toAlertDto(args: { row: typeof alerts.$inferSelect }): AlertDto {
  const type = parseAlertType({ value: args.row.type }) ?? "WATCHLIST_OPPORTUNITY";
  const channels = Array.isArray(args.row.channelsJson)
    ? (args.row.channelsJson as AlertChannel[])
    : (["in_app"] as AlertChannel[]);
  return {
    id: args.row.id,
    type,
    instrumentId: args.row.instrumentId,
    symbol: args.row.symbol,
    signalId: args.row.signalId,
    zoneId: args.row.zoneId,
    title: args.row.title,
    body: args.row.body,
    score: args.row.score,
    direction: (args.row.direction as SignalDirection | null) ?? null,
    state: args.row.state,
    dedupeKey: args.row.dedupeKey,
    channels,
    readAt: args.row.readAt?.toISOString() ?? null,
    createdAt: args.row.createdAt.toISOString(),
  };
}

export async function countUnreadAlerts(args: { db: Database }): Promise<number> {
  const rows = await args.db
    .select({ count: sql<number>`count(*)` })
    .from(alerts)
    .where(isNull(alerts.readAt));
  return Number(rows[0]?.count ?? 0);
}

export async function readAlerts(args: {
  db: Database;
  redis: Redis;
  unreadOnly: boolean;
}): Promise<AlertsResponse> {
  const staleStream = parseStreamSnapshot({ raw: await args.redis.get(REDIS_KEYS.stream).catch(() => null) }).stale;
  const unreadCount = await countUnreadAlerts({ db: args.db });
  const rows = await args.db
    .select()
    .from(alerts)
    .where(args.unreadOnly ? isNull(alerts.readAt) : undefined)
    .orderBy(desc(alerts.createdAt))
    .limit(ALERTS_INBOX_LIMIT);
  return {
    available: true,
    staleStream,
    unreadCount,
    alerts: rows.map((row) => toAlertDto({ row })),
  };
}

export async function publishUnreadSnapshot(args: { redis: Redis; unreadCount: number }): Promise<void> {
  const snapshot = parseStreamSnapshot({ raw: await args.redis.get(REDIS_KEYS.stream).catch(() => null) });
  await args.redis.publish(
    REDIS_KEYS.eventsChannel,
    JSON.stringify({
      type: "stream",
      payload: {
        streamStatus: snapshot.streamStatus,
        lastQuoteAt: snapshot.lastQuoteAt,
        unreadCount: args.unreadCount,
      },
    }),
  );
}

export async function markAlertRead(args: { db: Database; id: string }): Promise<"ok" | "not_found"> {
  const rows = await args.db.select().from(alerts).where(eq(alerts.id, args.id)).limit(1);
  if (!rows[0]) {
    return "not_found";
  }
  await args.db.update(alerts).set({ readAt: new Date() }).where(eq(alerts.id, args.id));
  return "ok";
}

export async function markAllAlertsRead(args: { db: Database }): Promise<number> {
  const updated = await args.db
    .update(alerts)
    .set({ readAt: new Date() })
    .where(and(isNull(alerts.readAt)))
    .returning({ id: alerts.id });
  return updated.length;
}


