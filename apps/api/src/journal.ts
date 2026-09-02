import type {
  JournalDetailResponse,
  JournalEntryDto,
  JournalListResponse,
  JournalPatch,
} from "@market-sentinel/contracts";
import { journalPatchSchema } from "@market-sentinel/contracts";
import { journalEntries, signals, tradePlans, type Database } from "@market-sentinel/db";
import { JOURNAL_DEFAULTS, parseJournalMatchStatus, type SignalDirection } from "@market-sentinel/domain";
import { resolveManualPlanPatch } from "@market-sentinel/journal";
import { desc, eq } from "drizzle-orm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSignalDto } from "./signals.js";

const JOURNAL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCREENSHOT_DIR = path.resolve(fileURLToPath(new URL("../../../data/journal-screenshots", import.meta.url)));

export function screenshotDir(): string {
  return SCREENSHOT_DIR;
}

export function isSafeJournalId(args: { id: string }): boolean {
  return JOURNAL_ID_PATTERN.test(args.id);
}

export function detectImageKind(args: { buffer: Buffer }): { contentType: string; ext: string } | null {
  if (args.buffer.byteLength < 12) {
    return null;
  }
  if (args.buffer[0] === 0x89 && args.buffer[1] === 0x50 && args.buffer[2] === 0x4e && args.buffer[3] === 0x47) {
    return { contentType: "image/png", ext: "png" };
  }
  if (args.buffer[0] === 0xff && args.buffer[1] === 0xd8 && args.buffer[2] === 0xff) {
    return { contentType: "image/jpeg", ext: "jpg" };
  }
  if (args.buffer.toString("ascii", 0, 4) === "RIFF" && args.buffer.toString("ascii", 8, 12) === "WEBP") {
    return { contentType: "image/webp", ext: "webp" };
  }
  if (args.buffer.toString("ascii", 0, 6) === "GIF87a" || args.buffer.toString("ascii", 0, 6) === "GIF89a") {
    return { contentType: "image/gif", ext: "gif" };
  }
  return null;
}

export function resolveScreenshotPath(args: { id: string; ext: string }): string | null {
  if (!isSafeJournalId({ id: args.id }) || !/^[a-z0-9]+$/i.test(args.ext)) {
    return null;
  }
  const root = screenshotDir();
  const resolved = path.resolve(root, `${args.id}.${args.ext}`);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}

export function emptyJournal(args?: { historyUnavailable?: boolean }): JournalListResponse {
  return { available: false, historyUnavailable: args?.historyUnavailable ?? false, entries: [] };
}

export function emptyJournalDetail(): JournalDetailResponse {
  return { available: false, entry: null, plan: null, signal: null, linkablePlans: [] };
}

export function toJournalDto(args: { row: typeof journalEntries.$inferSelect }): JournalEntryDto {
  const ruleBreaks = Array.isArray(args.row.ruleBreaksJson)
    ? args.row.ruleBreaksJson.filter((item): item is string => typeof item === "string")
    : [];
  const tags = Array.isArray(args.row.tagsJson)
    ? args.row.tagsJson.filter((item): item is string => typeof item === "string")
    : [];
  return {
    id: args.row.id,
    etoroPositionId: args.row.etoroPositionId,
    brokerTradeId: args.row.brokerTradeId,
    tradePlanId: args.row.tradePlanId,
    signalId: args.row.signalId,
    setupKey: args.row.setupKey,
    matchStatus: parseJournalMatchStatus({ value: args.row.matchStatus }) ?? "UNGATED",
    matchLocked: args.row.matchLocked,
    symbol: args.row.symbol,
    direction: args.row.direction as JournalEntryDto["direction"],
    openedAt: args.row.openedAt?.toISOString() ?? null,
    closedAt: args.row.closedAt?.toISOString() ?? null,
    openPrice: args.row.openPrice,
    closePrice: args.row.closePrice,
    units: args.row.units,
    realizedPnl: args.row.realizedPnl,
    fees: args.row.fees,
    resultR: args.row.resultR,
    maeUsd: args.row.maeUsd,
    maeR: args.row.maeR,
    mfeUsd: args.row.mfeUsd,
    mfeR: args.row.mfeR,
    followedPlan: args.row.followedPlan,
    ruleBreaks,
    thesisText: args.row.thesisText,
    preTradeEmotion: args.row.preTradeEmotion,
    postTradeEmotion: args.row.postTradeEmotion,
    notes: args.row.notes,
    screenshotUrl: args.row.screenshotUrl,
    tags,
    alignedWithTrend: args.row.alignedWithTrend,
    snapshotJson: (args.row.snapshotJson as Record<string, unknown>) ?? {},
    evidenceJson: (args.row.evidenceJson as Record<string, unknown>) ?? {},
  };
}

export async function readJournal(args: {
  db: Database;
  historyUnavailable: boolean;
}): Promise<JournalListResponse> {
  const rows = await args.db.select().from(journalEntries).orderBy(desc(journalEntries.openedAt));
  return {
    available: true,
    historyUnavailable: args.historyUnavailable,
    entries: rows.map((row) => toJournalDto({ row })),
  };
}

export async function readJournalDetail(args: { db: Database; id: string }): Promise<JournalDetailResponse> {
  const rows = await args.db.select().from(journalEntries).where(eq(journalEntries.id, args.id)).limit(1);
  const row = rows[0];
  if (!row) {
    return { available: true, entry: null, plan: null, signal: null, linkablePlans: [] };
  }
  const planRows = row.tradePlanId
    ? await args.db.select().from(tradePlans).where(eq(tradePlans.id, row.tradePlanId)).limit(1)
    : [];
  const plan = planRows[0];
  const signalRows = row.signalId
    ? await args.db.select().from(signals).where(eq(signals.id, row.signalId)).limit(1)
    : [];
  const signal = signalRows[0];
  return {
    available: true,
    entry: toJournalDto({ row }),
    plan: plan
      ? {
          id: plan.id,
          riskPct: plan.riskPct,
          riskAmountUsd: plan.riskAmountUsd,
          expectedR: plan.expectedR,
          stopLoss: plan.stopLoss,
          target1: plan.target1,
          gateStatus: plan.gateStatus,
          checklistJson: plan.checklistJson,
        }
      : null,
    signal: signal ? toSignalDto({ row: signal }) : null,
    linkablePlans: await readLinkablePlans({
      db: args.db,
      symbol: row.symbol,
      direction: row.direction as SignalDirection,
    }),
  };
}

export function parseJournalPatch(args: { body: unknown }): { ok: true; value: JournalPatch } | { ok: false; error: string } {
  const parsed = journalPatchSchema.safeParse(args.body ?? {});
  if (!parsed.success) {
    return { ok: false, error: "invalid journal patch" };
  }
  return { ok: true, value: parsed.data };
}

export async function patchJournal(args: {
  db: Database;
  id: string;
  patch: JournalPatch;
}): Promise<JournalDetailResponse | "not_found" | "invalid_plan" | "plan_in_use"> {
  if (!isSafeJournalId({ id: args.id })) {
    return "not_found";
  }
  const rows = await args.db.select().from(journalEntries).where(eq(journalEntries.id, args.id)).limit(1);
  const row = rows[0];
  if (!row) {
    return "not_found";
  }
  const next: Partial<typeof journalEntries.$inferInsert> = { updatedAt: new Date() };
  if (args.patch.notes !== undefined) next.notes = args.patch.notes;
  if (args.patch.thesisText !== undefined) next.thesisText = args.patch.thesisText;
  if (args.patch.preTradeEmotion !== undefined) next.preTradeEmotion = args.patch.preTradeEmotion;
  if (args.patch.postTradeEmotion !== undefined) next.postTradeEmotion = args.patch.postTradeEmotion;
  if (args.patch.followedPlan !== undefined) next.followedPlan = args.patch.followedPlan;
  if (args.patch.ruleBreaks !== undefined) next.ruleBreaksJson = args.patch.ruleBreaks;
  if (args.patch.tags !== undefined) next.tagsJson = args.patch.tags;
  if (args.patch.tradePlanId !== undefined) {
    const planMeta = await loadPlanMeta({ db: args.db, tradePlanId: args.patch.tradePlanId });
    const usedByOtherEntry = args.patch.tradePlanId
      ? await planUsedByOtherEntry({ db: args.db, tradePlanId: args.patch.tradePlanId, entryId: row.id })
      : false;
    const resolved = resolveManualPlanPatch({
      tradePlanId: args.patch.tradePlanId,
      entrySymbol: row.symbol,
      entryDirection: row.direction as SignalDirection,
      usedByOtherEntry,
      plan: planMeta,
    });
    if (!resolved.ok) {
      return resolved.error;
    }
    next.tradePlanId = resolved.match.tradePlanId;
    next.matchStatus = resolved.match.matchStatus;
    next.matchLocked = resolved.match.matchLocked;
    if (resolved.match.tradePlanId && planMeta) {
      const planRows = await args.db.select().from(tradePlans).where(eq(tradePlans.id, resolved.match.tradePlanId)).limit(1);
      const plan = planRows[0];
      next.signalId = plan?.signalId ?? null;
      if (plan?.signalId) {
        const signalRows = await args.db.select().from(signals).where(eq(signals.id, plan.signalId)).limit(1);
        next.setupKey = signalRows[0]?.strategyKey ?? row.setupKey;
      }
    } else {
      next.signalId = null;
      next.setupKey = null;
    }
  }
  try {
    await args.db.update(journalEntries).set(next).where(eq(journalEntries.id, args.id));
  } catch (error) {
    if (isUniqueViolation({ error })) {
      return "plan_in_use";
    }
    throw error;
  }
  return readJournalDetail({ db: args.db, id: args.id });
}

export async function saveJournalScreenshot(args: {
  db: Database;
  id: string;
  buffer: Buffer;
}): Promise<JournalDetailResponse | "not_found" | "invalid"> {
  if (!isSafeJournalId({ id: args.id })) {
    return "not_found";
  }
  const kind = detectImageKind({ buffer: args.buffer });
  if (!kind || args.buffer.byteLength === 0 || args.buffer.byteLength > JOURNAL_DEFAULTS.screenshotMaxBytes) {
    return "invalid";
  }
  const rows = await args.db.select().from(journalEntries).where(eq(journalEntries.id, args.id)).limit(1);
  if (!rows[0]) {
    return "not_found";
  }
  const filePath = resolveScreenshotPath({ id: args.id, ext: kind.ext });
  if (!filePath) {
    return "not_found";
  }
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await writeFile(filePath, args.buffer);
  const screenshotUrl = `/journal/${args.id}/screenshot`;
  await args.db.update(journalEntries).set({ screenshotUrl, updatedAt: new Date() }).where(eq(journalEntries.id, args.id));
  return readJournalDetail({ db: args.db, id: args.id });
}

export async function readJournalScreenshot(args: { db: Database; id: string }): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!isSafeJournalId({ id: args.id })) {
    return null;
  }
  try {
    const rows = await args.db.select().from(journalEntries).where(eq(journalEntries.id, args.id)).limit(1);
    if (!rows[0]) {
      return null;
    }
  } catch {
    return null;
  }
  for (const [ext, contentType] of [
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
    ["webp", "image/webp"],
    ["gif", "image/gif"],
  ] as const) {
    const filePath = resolveScreenshotPath({ id: args.id, ext });
    if (!filePath) {
      return null;
    }
    try {
      const buffer = await readFile(filePath);
      const kind = detectImageKind({ buffer });
      return { buffer, contentType: kind?.contentType ?? contentType };
    } catch {
      continue;
    }
  }
  return null;
}

async function loadPlanMeta(args: {
  db: Database;
  tradePlanId: string | null;
}): Promise<{ symbol: string; direction: SignalDirection; gateStatus: string } | null> {
  if (!args.tradePlanId) {
    return null;
  }
  const planRows = await args.db.select().from(tradePlans).where(eq(tradePlans.id, args.tradePlanId)).limit(1);
  const plan = planRows[0];
  if (!plan) {
    return null;
  }
  const signalRows = await args.db.select().from(signals).where(eq(signals.id, plan.signalId)).limit(1);
  const signal = signalRows[0];
  if (!signal) {
    return null;
  }
  return {
    symbol: signal.symbol,
    direction: plan.direction as SignalDirection,
    gateStatus: plan.gateStatus,
  };
}

async function planUsedByOtherEntry(args: { db: Database; tradePlanId: string; entryId: string }): Promise<boolean> {
  const rows = await args.db.select({ id: journalEntries.id, tradePlanId: journalEntries.tradePlanId }).from(journalEntries);
  return rows.some((row) => row.tradePlanId === args.tradePlanId && row.id !== args.entryId);
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

async function readLinkablePlans(args: {
  db: Database;
  symbol: string | null;
  direction: SignalDirection;
}): Promise<JournalDetailResponse["linkablePlans"]> {
  const used = await args.db.select({ tradePlanId: journalEntries.tradePlanId }).from(journalEntries);
  const usedIds = new Set(used.map((row) => row.tradePlanId).filter((id): id is string => Boolean(id)));
  const plans = await args.db.select().from(tradePlans).where(eq(tradePlans.gateStatus, "APPROVED"));
  const result: JournalDetailResponse["linkablePlans"] = [];
  for (const plan of plans) {
    if (!plan.approvedAt || usedIds.has(plan.id)) {
      continue;
    }
    const signalRows = await args.db.select().from(signals).where(eq(signals.id, plan.signalId)).limit(1);
    const signal = signalRows[0];
    if (!signal) {
      continue;
    }
    if (args.symbol && signal.symbol !== args.symbol) {
      continue;
    }
    if (plan.direction !== args.direction) {
      continue;
    }
    result.push({
      id: plan.id,
      signalId: plan.signalId,
      symbol: signal.symbol,
      direction: plan.direction as JournalDetailResponse["linkablePlans"][number]["direction"],
      approvedAt: plan.approvedAt.toISOString(),
      expectedR: plan.expectedR,
    });
  }
  return result;
}
