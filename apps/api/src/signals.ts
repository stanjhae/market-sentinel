import type { CreatePlanResponse, SignalDto, SignalDetailResponse, SignalsResponse } from "@market-sentinel/contracts";
import { REDIS_KEYS } from "@market-sentinel/contracts";
import { accountSnapshots, auditLogs, signals, tradePlans, type Database } from "@market-sentinel/db";
import {
  decidePlanGate,
  entryStatusFromState,
  isTimeframe,
  parseWatchlistSymbol,
  plannedEntryFromZone,
  type PsychologyChecklist,
  type SignalState,
  type Timeframe,
} from "@market-sentinel/domain";
import { randomUUID } from "node:crypto";
import { checklistOrReject, evaluateStoredPlan } from "./risk.js";
import { bestOpenTradeSetup, createPlanStub, dismissSignal, type SignalRecord } from "@market-sentinel/strategies";
import { and, desc, eq, gte, inArray, notInArray, type SQL } from "drizzle-orm";
import { Redis } from "ioredis";

const OPEN_STATES: SignalState[] = ["DETECTED", "WATCHING", "CONFIRMED", "TRADE_PLANNED", "ENTERED"];

export type SignalFilters = {
  scope?: "active" | "history";
  instrument?: string;
  strategy?: string;
  direction?: string;
  minScore?: number;
  state?: string;
  timeframe?: string;
};

export function emptySignals(): SignalsResponse {
  return { available: false, staleStream: false, signals: [] };
}

export function emptySignalDetail(): SignalDetailResponse {
  return { available: false, signal: null };
}

export function toSignalDto(args: { row: typeof signals.$inferSelect }): SignalDto {
  return {
    id: args.row.id,
    instrumentId: args.row.instrumentId,
    symbol: args.row.symbol,
    strategyKey: args.row.strategyKey,
    strategyVersion: args.row.strategyVersion,
    direction: args.row.direction as SignalDto["direction"],
    state: args.row.state as SignalDto["state"],
    triggerTimeframe: args.row.triggerTimeframe as Timeframe,
    detectedAt: args.row.detectedAt.toISOString(),
    watchingAt: args.row.watchingAt?.toISOString() ?? null,
    confirmedAt: args.row.confirmedAt?.toISOString() ?? null,
  tradePlannedAt: args.row.tradePlannedAt?.toISOString() ?? null,
  enteredAt: args.row.enteredAt?.toISOString() ?? null,
  closedAt: args.row.closedAt?.toISOString() ?? null,
  invalidatedAt: args.row.invalidatedAt?.toISOString() ?? null,
    expiredAt: args.row.expiredAt?.toISOString() ?? null,
    dismissedAt: args.row.dismissedAt?.toISOString() ?? null,
    score: args.row.score,
    confidenceLabel: args.row.confidenceLabel,
    entryStatus: entryStatusFromState({ state: args.row.state as SignalState }),
    entryZoneLow: args.row.entryZoneLow,
    entryZoneHigh: args.row.entryZoneHigh,
    invalidationPrice: args.row.invalidationPrice,
    target1: args.row.target1,
    target2: args.row.target2,
    target3: args.row.target3,
    riskRewardToT1: args.row.riskRewardToT1,
    riskRewardToT2: args.row.riskRewardToT2,
    lastEvaluatedOpenTimeUtc: args.row.lastEvaluatedOpenTimeUtc.toISOString(),
    evidenceJson: (args.row.evidenceJson as Record<string, unknown>) ?? {},
    snapshotJson: (args.row.snapshotJson as Record<string, unknown>) ?? {},
  };
}

export function parseSignalFilters(args: { query: Record<string, unknown> }): SignalFilters {
  const minScoreRaw = args.query.minScore;
  const minScore = typeof minScoreRaw === "string" && minScoreRaw !== "" ? Number(minScoreRaw) : undefined;
  return {
    scope: args.query.scope === "history" ? "history" : args.query.scope === "active" ? "active" : undefined,
    instrument: typeof args.query.instrument === "string" ? args.query.instrument : undefined,
    strategy: typeof args.query.strategy === "string" ? args.query.strategy : undefined,
    direction: typeof args.query.direction === "string" ? args.query.direction : undefined,
    minScore: minScore !== undefined && Number.isFinite(minScore) ? minScore : undefined,
    state: typeof args.query.state === "string" ? args.query.state : undefined,
    timeframe: typeof args.query.timeframe === "string" ? args.query.timeframe : undefined,
  };
}

export async function readSignals(args: { db: Database; redis: Redis; filters: SignalFilters }): Promise<SignalsResponse> {
  const staleStream = await isStreamStale({ redis: args.redis });
  if (args.filters.instrument && !parseWatchlistSymbol({ value: args.filters.instrument })) {
    return { available: true, staleStream, signals: [] };
  }
  if (args.filters.timeframe && !isTimeframe(args.filters.timeframe)) {
    return { available: true, staleStream, signals: [] };
  }
  const conditions = sqlFilters({ filters: args.filters });
  const rows = await args.db
    .select()
    .from(signals)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(signals.detectedAt));
  const filtered = rows.filter((row) => matchesFilters({ row, filters: args.filters }));
  return {
    available: true,
    staleStream,
    signals: filtered.map((row) => toSignalDto({ row })),
  };
}

export async function readSignal(args: { db: Database; id: string }): Promise<SignalDetailResponse> {
  const rows = await args.db.select().from(signals).where(eq(signals.id, args.id)).limit(1);
  const row = rows[0];
  if (!row) {
    return { available: true, signal: null };
  }
  return { available: true, signal: toSignalDto({ row }) };
}

export async function dismissStoredSignal(args: {
  db: Database;
  redis: Redis;
  id: string;
}): Promise<"ok" | "not_found" | "terminal"> {
  const rows = await args.db.select().from(signals).where(eq(signals.id, args.id)).limit(1);
  const row = rows[0];
  if (!row) {
    return "not_found";
  }
  const result = dismissSignal({ current: recordFromRow({ row }), now: new Date() });
  if (!result.changed || !result.next) {
    return "terminal";
  }
  await args.db
    .update(signals)
    .set({
      state: result.next.state,
      dismissedAt: result.next.dismissedAt,
      evidenceJson: result.next.evidenceJson,
      updatedAt: new Date(),
    })
    .where(eq(signals.id, args.id));
  await cacheSignalSummary({ db: args.db, redis: args.redis, symbol: row.symbol, instrumentId: row.instrumentId });
  return "ok";
}

export async function createApprovedPlan(args: {
  db: Database;
  redis: Redis;
  id: string;
  checklist: PsychologyChecklist | null;
  riskPct?: string;
  logRejection?: boolean;
}): Promise<CreatePlanResponse | { error: "not_found" }> {
  const rows = await args.db.select().from(signals).where(eq(signals.id, args.id)).limit(1);
  const row = rows[0];
  if (!row) {
    return { error: "not_found" };
  }
  const checklist = checklistOrReject({ checklist: args.checklist });
  const snapshots = await args.db.select().from(accountSnapshots).orderBy(desc(accountSnapshots.timestamp)).limit(1);
  const plannedEntry = plannedEntryFromZone({ low: row.entryZoneLow, high: row.entryZoneHigh });
  const evaluation = await evaluateStoredPlan({
    db: args.db,
    plan: {
      symbol: row.symbol,
      direction: row.direction as SignalRecord["direction"],
      plannedEntry,
      stopLoss: row.invalidationPrice,
      target1: row.target1,
      riskPct: args.riskPct ?? null,
      riskRewardToT1: row.riskRewardToT1,
    },
  });
  const decision = decidePlanGate({
    allowed: evaluation.allowed,
    checklistComplete: checklist.complete,
    signalState: row.state as SignalState,
  });
  if (decision === "BLOCKED") {
    const planId = randomUUID();
    await args.db.insert(tradePlans).values({
      id: planId,
      signalId: row.id,
      accountSnapshotId: snapshots[0]?.id ?? null,
      direction: row.direction,
      entryType: "MARKET",
      plannedEntry,
      stopLoss: row.invalidationPrice,
      target1: row.target1,
      target2: row.target2,
      target3: row.target3,
      riskPct: args.riskPct ?? evaluation.maxRiskPct,
      riskAmountUsd: evaluation.maxLossUsd,
      estimatedPositionSize: evaluation.positionSizeUsd,
      expectedR: evaluation.expectedR,
      gateStatus: "BLOCKED",
      blockReasonsJson: evaluation.blockReasons,
      checklistJson: args.checklist,
    });
    return {
      status: "BLOCKED",
      signalId: row.id,
      planId,
      allowed: false,
      blockReasons: evaluation.blockReasons,
      missingChecklist: checklist.missing,
      evaluation,
    };
  }
  if (decision === "PENDING_CHECKLIST") {
    if (args.logRejection) {
      await args.db.insert(auditLogs).values({
        id: randomUUID(),
        eventType: "CHECKLIST_REJECTED",
        instrumentId: row.instrumentId,
        payloadJson: { signalId: row.id, missing: checklist.missing },
      });
    }
    return {
      status: "PENDING_CHECKLIST",
      signalId: row.id,
      planId: null,
      allowed: false,
      blockReasons: ["checklist-incomplete"],
      missingChecklist: checklist.missing,
      evaluation,
    };
  }
  if (decision === "NOT_CONFIRMED") {
    return {
      status: "BLOCKED",
      signalId: row.id,
      planId: null,
      allowed: false,
      blockReasons: ["not-confirmed"],
      missingChecklist: [],
      evaluation,
    };
  }
  const result = createPlanStub({ current: recordFromRow({ row }), now: new Date() });
  if (!result.changed || !result.next) {
    return {
      status: "BLOCKED",
      signalId: row.id,
      planId: null,
      allowed: false,
      blockReasons: ["not-confirmed"],
      missingChecklist: [],
      evaluation,
    };
  }
  const planId = randomUUID();
  await args.db.insert(tradePlans).values({
    id: planId,
    signalId: row.id,
    accountSnapshotId: snapshots[0]?.id ?? null,
    direction: row.direction,
    entryType: "MARKET",
    plannedEntry,
    stopLoss: row.invalidationPrice,
    target1: row.target1,
    target2: row.target2,
    target3: row.target3,
    riskPct: args.riskPct ?? evaluation.maxRiskPct,
    riskAmountUsd: evaluation.maxLossUsd,
    estimatedPositionSize: evaluation.positionSizeUsd,
    expectedR: evaluation.expectedR,
    gateStatus: "APPROVED",
    blockReasonsJson: [],
    checklistJson: args.checklist,
    approvedAt: new Date(),
  });
  await args.db
    .update(signals)
    .set({
      state: result.next.state,
      tradePlannedAt: result.next.tradePlannedAt,
      evidenceJson: result.next.evidenceJson,
      snapshotJson: result.next.snapshotJson,
      updatedAt: new Date(),
    })
    .where(eq(signals.id, args.id));
  await cacheSignalSummary({ db: args.db, redis: args.redis, symbol: row.symbol, instrumentId: row.instrumentId });
  await args.db.insert(auditLogs).values({
    id: randomUUID(),
    eventType: "PLAN_APPROVED",
    instrumentId: row.instrumentId,
    payloadJson: { signalId: row.id, planId },
  });
  return {
    status: "APPROVED",
    signalId: row.id,
    planId,
    allowed: true,
    blockReasons: [],
    missingChecklist: [],
    evaluation,
  };
}

export function matchesFilters(args: { row: typeof signals.$inferSelect; filters: SignalFilters }): boolean {
  if (args.filters.scope === "active" && !OPEN_STATES.includes(args.row.state as SignalState)) {
    return false;
  }
  if (args.filters.scope === "history" && OPEN_STATES.includes(args.row.state as SignalState)) {
    return false;
  }
  if (args.filters.instrument) {
    const symbol = parseWatchlistSymbol({ value: args.filters.instrument });
    if (!symbol || args.row.symbol !== symbol) {
      return false;
    }
  }
  if (args.filters.strategy && args.row.strategyKey !== args.filters.strategy) {
    return false;
  }
  if (args.filters.direction && args.row.direction !== args.filters.direction) {
    return false;
  }
  if (args.filters.state && args.row.state !== args.filters.state) {
    return false;
  }
  if (args.filters.minScore !== undefined && args.row.score < args.filters.minScore) {
    return false;
  }
  if (args.filters.timeframe) {
    if (!isTimeframe(args.filters.timeframe) || args.row.triggerTimeframe !== args.filters.timeframe) {
      return false;
    }
  }
  return true;
}

function sqlFilters(args: { filters: SignalFilters }): SQL[] {
  const parts: SQL[] = [];
  if (args.filters.scope === "active") {
    parts.push(inArray(signals.state, OPEN_STATES));
  }
  if (args.filters.scope === "history") {
    parts.push(notInArray(signals.state, OPEN_STATES));
  }
  const symbol = args.filters.instrument ? parseWatchlistSymbol({ value: args.filters.instrument }) : null;
  if (symbol) {
    parts.push(eq(signals.symbol, symbol));
  }
  if (args.filters.strategy) {
    parts.push(eq(signals.strategyKey, args.filters.strategy));
  }
  if (args.filters.direction) {
    parts.push(eq(signals.direction, args.filters.direction));
  }
  if (args.filters.state) {
    parts.push(eq(signals.state, args.filters.state));
  }
  if (args.filters.minScore !== undefined) {
    parts.push(gte(signals.score, args.filters.minScore));
  }
  if (args.filters.timeframe && isTimeframe(args.filters.timeframe)) {
    parts.push(eq(signals.triggerTimeframe, args.filters.timeframe));
  }
  return parts;
}

async function isStreamStale(args: { redis: Redis }): Promise<boolean> {
  const raw = await args.redis.get(REDIS_KEYS.stream);
  if (!raw) {
    return true;
  }
  const stream = JSON.parse(raw) as { streamStatus?: string };
  return stream.streamStatus === "STALE" || stream.streamStatus === "DISCONNECTED";
}

function recordFromRow(args: { row: typeof signals.$inferSelect }): SignalRecord {
  return {
    id: args.row.id,
    instrumentId: args.row.instrumentId,
    symbol: args.row.symbol,
    strategyKey: args.row.strategyKey as SignalRecord["strategyKey"],
    strategyVersion: args.row.strategyVersion,
    direction: args.row.direction as SignalRecord["direction"],
    state: args.row.state as SignalRecord["state"],
    triggerTimeframe: args.row.triggerTimeframe as Timeframe,
    detectedAt: args.row.detectedAt,
    watchingAt: args.row.watchingAt,
    confirmedAt: args.row.confirmedAt,
    tradePlannedAt: args.row.tradePlannedAt,
    enteredAt: args.row.enteredAt,
    closedAt: args.row.closedAt,
    invalidatedAt: args.row.invalidatedAt,
    expiredAt: args.row.expiredAt,
    dismissedAt: args.row.dismissedAt,
    score: args.row.score,
    confidenceLabel: args.row.confidenceLabel as SignalRecord["confidenceLabel"],
    entryZoneLow: args.row.entryZoneLow,
    entryZoneHigh: args.row.entryZoneHigh,
    invalidationPrice: args.row.invalidationPrice,
    target1: args.row.target1,
    target2: args.row.target2,
    target3: args.row.target3,
    riskRewardToT1: args.row.riskRewardToT1,
    riskRewardToT2: args.row.riskRewardToT2,
    lastEvaluatedOpenTimeUtc: args.row.lastEvaluatedOpenTimeUtc,
    evidenceJson: (args.row.evidenceJson as Record<string, unknown>) ?? {},
    snapshotJson: (args.row.snapshotJson as Record<string, unknown>) ?? {},
  };
}

async function cacheSignalSummary(args: {
  db: Database;
  redis: Redis;
  symbol: string;
  instrumentId: string;
}): Promise<void> {
  const rows = await args.db.select().from(signals).where(eq(signals.instrumentId, args.instrumentId));
  const best = bestOpenTradeSetup({ records: rows });
  await args.redis.set(
    REDIS_KEYS.signals(args.symbol),
    JSON.stringify(
      best
        ? {
            opportunityScore: best.score,
            opportunityLabel: best.confidenceLabel,
            signalState: best.state,
            signalExplanation: `${best.strategyKey} ${best.direction.toLowerCase()}`,
            entryStatus: entryStatusFromState({ state: best.state as SignalState }),
          }
        : {
            opportunityScore: null,
            opportunityLabel: null,
            signalState: null,
            signalExplanation: null,
            entryStatus: null,
          },
    ),
  );
}
