import type { PriceZoneDto, ZonesResponse } from "@market-sentinel/contracts";
import { REDIS_KEYS } from "@market-sentinel/contracts";
import { instruments, priceZones, type Database } from "@market-sentinel/db";
import { parseWatchlistSymbol, type Timeframe, type ZoneType } from "@market-sentinel/domain";
import { zoneMidpoint } from "@market-sentinel/market-structure";
import { Decimal } from "decimal.js";
import { and, eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { toZoneDto } from "./candles.js";

export function emptyZones(args: { symbol: string }): ZonesResponse {
  return { available: false, symbol: args.symbol, zones: [] };
}

export async function readZones(args: { db: Database; symbol: string }): Promise<ZonesResponse> {
  const symbol = parseWatchlistSymbol({ value: args.symbol });
  if (!symbol) {
    return emptyZones({ symbol: args.symbol });
  }
  const instrument = await args.db.select().from(instruments).where(eq(instruments.canonicalSymbol, symbol)).limit(1);
  const row = instrument[0];
  if (!row) {
    return emptyZones({ symbol });
  }
  const rows = await args.db.select().from(priceZones).where(eq(priceZones.instrumentId, row.id));
  return {
    available: true,
    symbol,
    zones: rows.map((item) => toZoneDto({ row: item, symbol })),
  };
}

export function parseManualZoneBody(args: { body: unknown }): { ok: true; value: ManualZoneInput } | { ok: false; error: string } {
  if (!args.body || typeof args.body !== "object") {
    return { ok: false, error: "invalid body" };
  }
  const body = args.body as Record<string, unknown>;
  const type = body.type;
  if (type !== "SUPPORT" && type !== "RESISTANCE" && type !== "BOTH") {
    return { ok: false, error: "invalid type" };
  }
  const timeframe = body.timeframe;
  if (timeframe !== undefined && timeframe !== "15m" && timeframe !== "1h" && timeframe !== "4h") {
    return { ok: false, error: "invalid timeframe" };
  }
  const bounds = resolveBounds({
    lowerBound: typeof body.lowerBound === "string" ? body.lowerBound : undefined,
    upperBound: typeof body.upperBound === "string" ? body.upperBound : undefined,
    midpoint: typeof body.midpoint === "string" ? body.midpoint : undefined,
    width: typeof body.width === "string" ? body.width : undefined,
  });
  if (!bounds) {
    return { ok: false, error: "invalid bounds" };
  }
  return {
    ok: true,
    value: {
      type,
      timeframe: (timeframe as Timeframe | undefined) ?? "15m",
      lowerBound: bounds.lowerBound,
      upperBound: bounds.upperBound,
      midpoint: bounds.midpoint,
      note: typeof body.note === "string" ? body.note : undefined,
    },
  };
}

export async function createManualZone(args: {
  db: Database;
  redis?: Redis;
  symbol: string;
  input: ManualZoneInput;
}): Promise<PriceZoneDto | null> {
  const symbol = parseWatchlistSymbol({ value: args.symbol });
  if (!symbol) {
    return null;
  }
  const instrument = await args.db.select().from(instruments).where(eq(instruments.canonicalSymbol, symbol)).limit(1);
  const row = instrument[0];
  if (!row) {
    return null;
  }
  const id = randomUUID();
  const values = {
    id,
    instrumentId: row.id,
    timeframe: args.input.timeframe,
    type: args.input.type,
    source: "USER_MANUAL" as const,
    lowerBound: args.input.lowerBound,
    upperBound: args.input.upperBound,
    midpoint: args.input.midpoint,
    strengthScore: 80,
    touchCount: 0,
    lastTouchedAt: null,
    status: "ACTIVE" as const,
    metadataJson: { why: "USER_MANUAL", note: args.input.note ?? null },
    updatedAt: new Date(),
  };
  await args.db.insert(priceZones).values(values);
  await refreshZonesCache({ db: args.db, redis: args.redis, symbol });
  return toZoneDto({ row: { ...values, createdAt: new Date() }, symbol });
}

export async function updateManualZone(args: {
  db: Database;
  redis?: Redis;
  symbol: string;
  id: string;
  input: Partial<ManualZoneInput> & { status?: PriceZoneDto["status"] };
}): Promise<PriceZoneDto | "not_found" | "not_manual" | "invalid_bounds"> {
  const existing = await findZone({ db: args.db, symbol: args.symbol, id: args.id });
  if (!existing) {
    return "not_found";
  }
  if (existing.row.source !== "USER_MANUAL") {
    return "not_manual";
  }
  const lowerBound = args.input.lowerBound ?? existing.row.lowerBound;
  const upperBound = args.input.upperBound ?? existing.row.upperBound;
  if (!orderedBounds({ lowerBound, upperBound })) {
    return "invalid_bounds";
  }
  const next = {
    type: args.input.type ?? existing.row.type,
    timeframe: args.input.timeframe ?? existing.row.timeframe,
    lowerBound,
    upperBound,
    midpoint: zoneMidpoint({ lowerBound, upperBound }),
    status: args.input.status ?? existing.row.status,
    metadataJson: {
      ...((existing.row.metadataJson as Record<string, unknown>) ?? {}),
      note: args.input.note ?? (existing.row.metadataJson as { note?: string } | null)?.note ?? null,
    },
    updatedAt: new Date(),
  };
  await args.db.update(priceZones).set(next).where(eq(priceZones.id, args.id));
  await refreshZonesCache({ db: args.db, redis: args.redis, symbol: existing.symbol });
  return toZoneDto({ row: { ...existing.row, ...next }, symbol: existing.symbol });
}

export async function deleteManualZone(args: {
  db: Database;
  redis?: Redis;
  symbol: string;
  id: string;
}): Promise<"ok" | "not_found" | "not_manual"> {
  const existing = await findZone({ db: args.db, symbol: args.symbol, id: args.id });
  if (!existing) {
    return "not_found";
  }
  if (existing.row.source !== "USER_MANUAL") {
    return "not_manual";
  }
  await args.db.delete(priceZones).where(eq(priceZones.id, args.id));
  await refreshZonesCache({ db: args.db, redis: args.redis, symbol: existing.symbol });
  return "ok";
}

export type ManualZoneInput = {
  type: ZoneType;
  timeframe: Timeframe;
  lowerBound: string;
  upperBound: string;
  midpoint: string;
  note?: string;
};

export function parseBoundString(args: { value: unknown }): string | null {
  if (typeof args.value !== "string" || args.value.trim() === "") {
    return null;
  }
  try {
    const value = new Decimal(args.value);
    if (!value.isFinite()) {
      return null;
    }
    return value.toString();
  } catch {
    return null;
  }
}

export function orderedBounds(args: { lowerBound: string; upperBound: string }): boolean {
  try {
    return new Decimal(args.lowerBound).lte(new Decimal(args.upperBound));
  } catch {
    return false;
  }
}

function resolveBounds(args: {
  lowerBound?: string;
  upperBound?: string;
  midpoint?: string;
  width?: string;
}): { lowerBound: string; upperBound: string; midpoint: string } | null {
  const lowerBound = parseBoundString({ value: args.lowerBound });
  const upperBound = parseBoundString({ value: args.upperBound });
  if (lowerBound && upperBound) {
    if (!orderedBounds({ lowerBound, upperBound })) {
      return null;
    }
    return {
      lowerBound,
      upperBound,
      midpoint: zoneMidpoint({ lowerBound, upperBound }),
    };
  }
  const midpoint = parseBoundString({ value: args.midpoint });
  const width = parseBoundString({ value: args.width });
  if (midpoint && width) {
    const mid = new Decimal(midpoint);
    const span = new Decimal(width);
    if (span.lte(0)) {
      return null;
    }
    const half = span.div(2);
    return {
      lowerBound: mid.minus(half).toString(),
      upperBound: mid.plus(half).toString(),
      midpoint: mid.toString(),
    };
  }
  return null;
}

export async function refreshZonesCache(args: {
  db: Database;
  redis?: Redis;
  symbol: string;
}): Promise<void> {
  if (!args.redis) {
    return;
  }
  try {
    const snapshot = await readZones({ db: args.db, symbol: args.symbol });
    await args.redis.set(REDIS_KEYS.zones(args.symbol), JSON.stringify(snapshot.zones));
  } catch {
    // Context reads Postgres; the worker rewrites Redis on the next eval.
  }
}

async function findZone(args: { db: Database; symbol: string; id: string }) {
  const symbol = parseWatchlistSymbol({ value: args.symbol });
  if (!symbol) {
    return null;
  }
  const instrument = await args.db.select().from(instruments).where(eq(instruments.canonicalSymbol, symbol)).limit(1);
  const instrumentRow = instrument[0];
  if (!instrumentRow) {
    return null;
  }
  const rows = await args.db
    .select()
    .from(priceZones)
    .where(and(eq(priceZones.id, args.id), eq(priceZones.instrumentId, instrumentRow.id)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { row, symbol };
}
