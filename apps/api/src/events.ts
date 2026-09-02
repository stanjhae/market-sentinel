import type { EventsResponse } from "@market-sentinel/contracts";
import { economicEvents, type Database } from "@market-sentinel/db";
import { RISK_DEFAULTS } from "@market-sentinel/domain";
import { isBlackoutActive, type EconomicEvent } from "@market-sentinel/risk-engine";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export function emptyEvents(): EventsResponse {
  return { available: false, newsBlackout: false, events: [] };
}

export async function readEvents(args: { db: Database; now?: Date }): Promise<EventsResponse> {
  const rows = await args.db.select().from(economicEvents);
  const events = rows.map(toDto);
  return {
    available: true,
    newsBlackout: isBlackoutActive({ events: rows.map(toDomain), now: args.now ?? new Date() }),
    events,
  };
}

export async function createEvent(args: {
  db: Database;
  eventName: string;
  currency: string;
  impact: "LOW" | "MEDIUM" | "HIGH";
  scheduledAtUtc: Date;
  blackoutBeforeMinutes?: number;
  blackoutAfterMinutes?: number;
}): Promise<EventsResponse> {
  await args.db.insert(economicEvents).values({
    id: randomUUID(),
    eventName: args.eventName,
    currency: args.currency,
    impact: args.impact,
    scheduledAtUtc: args.scheduledAtUtc,
    blackoutBeforeMinutes: args.blackoutBeforeMinutes ?? RISK_DEFAULTS.blackoutBeforeMinutes,
    blackoutAfterMinutes: args.blackoutAfterMinutes ?? RISK_DEFAULTS.blackoutAfterMinutes,
  });
  return readEvents({ db: args.db });
}

export async function deleteEvent(args: { db: Database; id: string }): Promise<boolean> {
  const deleted = await args.db.delete(economicEvents).where(eq(economicEvents.id, args.id)).returning({ id: economicEvents.id });
  return deleted.length > 0;
}

function toDomain(row: typeof economicEvents.$inferSelect): EconomicEvent {
  return {
    id: row.id,
    eventName: row.eventName,
    currency: row.currency,
    impact: row.impact as EconomicEvent["impact"],
    scheduledAtUtc: row.scheduledAtUtc,
    blackoutBeforeMinutes: row.blackoutBeforeMinutes,
    blackoutAfterMinutes: row.blackoutAfterMinutes,
  };
}

function toDto(row: typeof economicEvents.$inferSelect) {
  return {
    id: row.id,
    eventName: row.eventName,
    currency: row.currency,
    impact: row.impact as "LOW" | "MEDIUM" | "HIGH",
    scheduledAtUtc: row.scheduledAtUtc.toISOString(),
    blackoutBeforeMinutes: row.blackoutBeforeMinutes,
    blackoutAfterMinutes: row.blackoutAfterMinutes,
  };
}
