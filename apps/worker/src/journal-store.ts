import { auditLogs, brokerPositions, brokerTrades, journalEntries, signals, tradePlans, type Database } from "@market-sentinel/db";
import { parseWatchlistSymbol, trendAligned, type SignalDirection } from "@market-sentinel/domain";
import {
  computeResultR,
  decideInitialMatch,
  decideJournalClose,
  updateExcursion,
  type MatchCandidate,
} from "@market-sentinel/journal";
import { markSignalClosed, markSignalEntered } from "@market-sentinel/strategies";
import { createLogger } from "@market-sentinel/observability";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { publishSignalChanged } from "./alert-store.js";
import { cacheSignalSummary, persistSignal, rowToSignal } from "./signal-store.js";

const logger = createLogger("worker-journal");

type JournalRow = typeof journalEntries.$inferSelect;

export function primaryTrendFromSnapshot(args: { snapshotJson: unknown }): string | null {
  if (!args.snapshotJson || typeof args.snapshotJson !== "object") {
    return null;
  }
  const snapshot = args.snapshotJson as {
    multiTimeframe?: { context4h?: { primaryTrend?: string | null } };
  };
  return snapshot.multiTimeframe?.context4h?.primaryTrend ?? null;
}

export function isOpenJournal(args: { closedAt: Date | null }): boolean {
  return args.closedAt === null;
}

export async function reconcileJournal(args: {
  db: Database;
  redis?: Redis;
  now?: Date;
}): Promise<void> {
  const now = args.now ?? new Date();
  const [positions, trades, existing, plans] = await Promise.all([
    args.db.select().from(brokerPositions),
    args.db.select().from(brokerTrades),
    args.db.select().from(journalEntries),
    loadMatchCandidates({ db: args.db }),
  ]);
  const byPosition = new Map(existing.map((row) => [row.etoroPositionId, row]));
  const usedPlanIds = existing.map((row) => row.tradePlanId).filter((id): id is string => Boolean(id));
  const openIds = new Set(positions.map((position) => position.etoroPositionId));
  const tradeByPosition = new Map(trades.map((row) => [row.etoroPositionId, row]));

  for (const position of positions) {
    if (byPosition.has(position.etoroPositionId)) {
      continue;
    }
    const openedAt = position.openedAt;
    const symbol = position.symbol ?? "";
    const match = decideInitialMatch({
      historicalClosed: false,
      symbol,
      direction: position.direction as SignalDirection,
      openedAt,
      usedPlanIds,
      plans: plans.candidates,
    });
    const linked = match.planId ? plans.byId.get(match.planId) : undefined;
    const id = randomUUID();
    const row: JournalRow = {
      id,
      etoroPositionId: position.etoroPositionId,
      brokerTradeId: null,
      tradePlanId: match.planId,
      signalId: linked?.signalId ?? null,
      setupKey: linked?.setupKey ?? null,
      matchStatus: match.status,
      matchLocked: false,
      symbol: position.symbol,
      instrumentId: position.instrumentId,
      direction: position.direction,
      openedAt,
      closedAt: null,
      openPrice: position.openPrice,
      closePrice: null,
      units: position.units,
      realizedPnl: null,
      fees: position.fees,
      thesisText: null,
      preTradeEmotion: null,
      postTradeEmotion: null,
      followedPlan: match.status === "LINKED" ? true : null,
      ruleBreaksJson: [],
      maeUsd: null,
      maeR: null,
      mfeUsd: null,
      mfeR: null,
      resultR: null,
      notes: null,
      screenshotUrl: null,
      tagsJson: null,
      alignedWithTrend: linked
        ? trendAligned({
            direction: position.direction as SignalDirection,
            primaryTrend: primaryTrendFromSnapshot({ snapshotJson: linked.snapshotJson }),
          })
        : null,
      snapshotJson: linked?.snapshotJson ?? {},
      evidenceJson: linked?.evidenceJson ?? { candidateIds: match.candidateIds },
      createdAt: now,
      updatedAt: now,
    };
    await args.db.insert(journalEntries).values(row);
    if (match.planId) {
      usedPlanIds.push(match.planId);
    }
    byPosition.set(position.etoroPositionId, row);
    await args.db.insert(auditLogs).values({
      id: randomUUID(),
      eventType: "JOURNAL_OPENED",
      instrumentId: position.symbol,
      payloadJson: { etoroPositionId: position.etoroPositionId, matchStatus: match.status, planId: match.planId },
    });
  }

  for (const trade of trades) {
    if (byPosition.has(trade.etoroPositionId)) {
      continue;
    }
    const id = randomUUID();
    const row: JournalRow = {
      id,
      etoroPositionId: trade.etoroPositionId,
      brokerTradeId: trade.id,
      tradePlanId: null,
      signalId: null,
      setupKey: null,
      matchStatus: "UNGATED",
      matchLocked: false,
      symbol: trade.symbol,
      instrumentId: trade.instrumentId,
      direction: trade.direction,
      openedAt: trade.openedAt,
      closedAt: trade.closedAt,
      openPrice: trade.openPrice,
      closePrice: trade.closePrice,
      units: trade.units,
      realizedPnl: trade.realizedPnl,
      fees: trade.fees,
      thesisText: null,
      preTradeEmotion: null,
      postTradeEmotion: null,
      followedPlan: null,
      ruleBreaksJson: [],
      maeUsd: null,
      maeR: null,
      mfeUsd: null,
      mfeR: null,
      resultR: computeResultR({
        realizedPnl: trade.realizedPnl,
        riskAmountUsd: null,
        openPrice: trade.openPrice,
        stopLoss: trade.stopLoss,
        units: trade.units,
      }),
      notes: null,
      screenshotUrl: null,
      tagsJson: null,
      alignedWithTrend: null,
      snapshotJson: { historical: true },
      evidenceJson: { reason: "historical-backfill" },
      createdAt: now,
      updatedAt: now,
    };
    await args.db.insert(journalEntries).values(row);
    byPosition.set(trade.etoroPositionId, row);
    await args.db.insert(auditLogs).values({
      id: randomUUID(),
      eventType: "JOURNAL_BACKFILL",
      instrumentId: trade.symbol,
      payloadJson: { etoroPositionId: trade.etoroPositionId },
    });
  }

  for (const current of byPosition.values()) {
    const action = decideJournalClose({
      alreadyClosed: Boolean(current.closedAt),
      stillOpenOnBroker: openIds.has(current.etoroPositionId),
      hasClosedHistory: tradeByPosition.has(current.etoroPositionId),
    });
    if (action === "noop") {
      continue;
    }
    const trade = tradeByPosition.get(current.etoroPositionId);
    const linkedPlan = current.tradePlanId ? plans.byId.get(current.tradePlanId) : undefined;
    const closedAt = action === "close-from-history" ? (trade?.closedAt ?? now) : now;
    const realizedPnl = action === "close-from-history" ? (trade?.realizedPnl ?? current.realizedPnl) : current.realizedPnl;
    const resultR = computeResultR({
      realizedPnl,
      riskAmountUsd: linkedPlan?.riskAmountUsd ?? null,
      openPrice: trade?.openPrice ?? current.openPrice,
      stopLoss: trade?.stopLoss ?? linkedPlan?.stopLoss ?? null,
      units: trade?.units ?? current.units,
    });
    await args.db
      .update(journalEntries)
      .set({
        brokerTradeId: trade?.id ?? current.brokerTradeId,
        closedAt,
        closePrice: trade?.closePrice ?? current.closePrice,
        realizedPnl,
        fees: trade?.fees ?? current.fees,
        resultR,
        evidenceJson:
          action === "close-vanished"
            ? {
                ...(typeof current.evidenceJson === "object" && current.evidenceJson ? current.evidenceJson : {}),
                reason: "position-vanished-without-history",
              }
            : current.evidenceJson,
        updatedAt: now,
      })
      .where(eq(journalEntries.id, current.id));
    current.closedAt = closedAt;
    await advanceLinkedSignal({
      db: args.db,
      redis: args.redis,
      signalId: current.signalId,
      to: "CLOSED",
      now: closedAt,
    });
  }

  for (const position of positions) {
    const row = byPosition.get(position.etoroPositionId);
    if (!row || row.closedAt) {
      continue;
    }
    await advanceLinkedSignal({
      db: args.db,
      redis: args.redis,
      signalId: row.signalId,
      to: "ENTERED",
      now,
    });
  }
}

export async function updateOpenExcursions(args: {
  db: Database;
  symbol: string;
  lastPrice: string;
}): Promise<void> {
  const open = await args.db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.symbol, args.symbol), isNull(journalEntries.closedAt)));
  if (open.length === 0) {
    return;
  }
  const planIds = open.map((row) => row.tradePlanId).filter((id): id is string => Boolean(id));
  const planById = new Map<string, typeof tradePlans.$inferSelect>();
  if (planIds.length > 0) {
    const planRows = await args.db.select().from(tradePlans).where(inArray(tradePlans.id, planIds));
    for (const row of planRows) {
      planById.set(row.id, row);
    }
  }
  for (const row of open) {
    const plan = row.tradePlanId ? planById.get(row.tradePlanId) : undefined;
    const next = updateExcursion({
      previous: { maeUsd: row.maeUsd, maeR: row.maeR, mfeUsd: row.mfeUsd, mfeR: row.mfeR },
      direction: row.direction as SignalDirection,
      entryPrice: row.openPrice,
      lastPrice: args.lastPrice,
      units: row.units,
      riskAmountUsd: plan?.riskAmountUsd ?? null,
      stopLoss: plan?.stopLoss ?? null,
    });
    if (!next.changed) {
      continue;
    }
    await args.db
      .update(journalEntries)
      .set({
        maeUsd: next.maeUsd,
        maeR: next.maeR,
        mfeUsd: next.mfeUsd,
        mfeR: next.mfeR,
        updatedAt: new Date(),
      })
      .where(eq(journalEntries.id, row.id));
  }
}

async function loadMatchCandidates(args: { db: Database }): Promise<{
  candidates: MatchCandidate[];
  byId: Map<
    string,
    {
      signalId: string;
      setupKey: string | null;
      snapshotJson: unknown;
      evidenceJson: unknown;
      riskAmountUsd: string | null;
      stopLoss: string | null;
    }
  >;
}> {
  const rows = await args.db.select().from(tradePlans);
  const signalRows = await args.db.select().from(signals);
  const signalById = new Map(signalRows.map((row) => [row.id, row]));
  const candidates: MatchCandidate[] = [];
  const byId = new Map<
    string,
    {
      signalId: string;
      setupKey: string | null;
      snapshotJson: unknown;
      evidenceJson: unknown;
      riskAmountUsd: string | null;
      stopLoss: string | null;
    }
  >();
  for (const row of rows) {
    if (row.gateStatus !== "APPROVED" || !row.approvedAt) {
      continue;
    }
    const signal = signalById.get(row.signalId);
    if (!signal) {
      continue;
    }
    candidates.push({
      planId: row.id,
      symbol: signal.symbol,
      direction: row.direction as SignalDirection,
      approvedAt: row.approvedAt,
    });
    byId.set(row.id, {
      signalId: row.signalId,
      setupKey: signal.strategyKey,
      snapshotJson: signal.snapshotJson,
      evidenceJson: signal.evidenceJson,
      riskAmountUsd: row.riskAmountUsd,
      stopLoss: row.stopLoss,
    });
  }
  return { candidates, byId };
}

async function advanceLinkedSignal(args: {
  db: Database;
  redis?: Redis;
  signalId: string | null;
  to: "ENTERED" | "CLOSED";
  now: Date;
}): Promise<void> {
  if (!args.signalId) {
    return;
  }
  const rows = await args.db.select().from(signals).where(eq(signals.id, args.signalId)).limit(1);
  const row = rows[0];
  if (!row) {
    return;
  }
  const current = rowToSignal({ row });
  const result = args.to === "ENTERED" ? markSignalEntered({ current, now: args.now }) : markSignalClosed({ current, now: args.now });
  if (!result.changed || !result.next) {
    return;
  }
  try {
    await persistSignal({ db: args.db, record: result.next });
    await args.db.insert(auditLogs).values({
      id: randomUUID(),
      eventType: "SIGNAL_STATE_CHANGED",
      instrumentId: result.next.instrumentId,
      payloadJson: { signalId: result.next.id, state: result.next.state, reason: "broker-match" },
    });
    if (args.redis) {
      await publishSignalChanged({ redis: args.redis, record: result.next });
      const symbol = parseWatchlistSymbol({ value: result.next.symbol });
      if (symbol) {
        await cacheSignalSummary({
          db: args.db,
          redis: args.redis,
          instrument: { id: result.next.instrumentId, symbol },
        });
      }
    }
  } catch (error) {
    logger.warn({ err: error, signalId: args.signalId, to: args.to }, "journal signal persist skipped");
  }
}
