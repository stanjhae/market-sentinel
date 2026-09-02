import { alertSettingsSchema, type SettingsResponse } from "@market-sentinel/contracts";
import { appSettings, type Database } from "@market-sentinel/db";
import { DEFAULT_ALERT_SETTINGS, mergeAlertSettings } from "@market-sentinel/domain";
import { eq } from "drizzle-orm";

export function emptySettings(args: { telegramConfigured: boolean }): SettingsResponse {
  return {
    available: false,
    telegramConfigured: args.telegramConfigured,
    alerts: DEFAULT_ALERT_SETTINGS,
    risk: {},
    markets: {},
  };
}

export async function readSettings(args: { db: Database; telegramConfigured: boolean }): Promise<SettingsResponse> {
  const row = await ensureSettingsRow({ db: args.db });
  return {
    available: true,
    telegramConfigured: args.telegramConfigured,
    alerts: mergeAlertSettings({ raw: row.alertsJson }),
    risk: (row.riskJson as Record<string, unknown>) ?? {},
    markets: (row.marketsJson as Record<string, unknown>) ?? {},
  };
}

export async function patchAlertSettings(args: {
  db: Database;
  telegramConfigured: boolean;
  patch: unknown;
}): Promise<{ ok: true; settings: SettingsResponse } | { ok: false; error: string }> {
  const parsed = alertSettingsSchema.partial().safeParse(args.patch);
  if (!parsed.success) {
    return { ok: false, error: "invalid alert settings" };
  }
  const row = await ensureSettingsRow({ db: args.db });
  const current = mergeAlertSettings({ raw: row.alertsJson });
  const next = { ...current, ...parsed.data };
  await args.db
    .update(appSettings)
    .set({ alertsJson: next, updatedAt: new Date() })
    .where(eq(appSettings.id, "default"));
  return { ok: true, settings: await readSettings({ db: args.db, telegramConfigured: args.telegramConfigured }) };
}

export const SETTINGS_JSON_MAX_BYTES = 8_192;
export const SETTINGS_JSON_MAX_KEYS = 32;

export function parseJsonBucketPatch(args: { patch: unknown }):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string } {
  if (!args.patch || typeof args.patch !== "object" || Array.isArray(args.patch)) {
    return { ok: false, error: "invalid json object" };
  }
  const forbidden = ["__proto__", "constructor", "prototype"];
  const value: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(args.patch as Record<string, unknown>)) {
    if (forbidden.includes(key)) {
      return { ok: false, error: "invalid json object" };
    }
    value[key] = entry;
  }
  if (Object.keys(value).length > SETTINGS_JSON_MAX_KEYS) {
    return { ok: false, error: "invalid json object" };
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > SETTINGS_JSON_MAX_BYTES) {
    return { ok: false, error: "invalid json object" };
  }
  return { ok: true, value };
}

export async function patchJsonBucket(args: {
  db: Database;
  telegramConfigured: boolean;
  bucket: "risk" | "markets";
  patch: unknown;
}): Promise<{ ok: true; settings: SettingsResponse } | { ok: false; error: string }> {
  const parsed = parseJsonBucketPatch({ patch: args.patch });
  if (!parsed.ok) {
    return parsed;
  }
  const row = await ensureSettingsRow({ db: args.db });
  const current = (args.bucket === "risk" ? row.riskJson : row.marketsJson) as Record<string, unknown>;
  const next = { ...current, ...parsed.value };
  const merged = parseJsonBucketPatch({ patch: next });
  if (!merged.ok) {
    return merged;
  }
  await args.db
    .update(appSettings)
    .set({
      riskJson: args.bucket === "risk" ? merged.value : row.riskJson,
      marketsJson: args.bucket === "markets" ? merged.value : row.marketsJson,
      updatedAt: new Date(),
    })
    .where(eq(appSettings.id, "default"));
  return { ok: true, settings: await readSettings({ db: args.db, telegramConfigured: args.telegramConfigured }) };
}

async function ensureSettingsRow(args: { db: Database }) {
  const existing = await args.db.select().from(appSettings).where(eq(appSettings.id, "default")).limit(1);
  if (existing[0]) {
    return existing[0];
  }
  await args.db.insert(appSettings).values({
    id: "default",
    alertsJson: DEFAULT_ALERT_SETTINGS,
    riskJson: {},
    marketsJson: {},
    updatedAt: new Date(),
  });
  const created = await args.db.select().from(appSettings).where(eq(appSettings.id, "default")).limit(1);
  return created[0]!;
}
