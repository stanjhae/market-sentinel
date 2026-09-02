import type { AccountResponse, RiskStatus } from "@market-sentinel/contracts";
import { REDIS_KEYS } from "@market-sentinel/contracts";
import {
  accountSnapshots,
  appSettings,
  auditLogs,
  brokerPositions,
  brokerTrades,
  economicEvents,
  instruments,
  riskState,
  tradePlans,
  type Database,
} from "@market-sentinel/db";
import {
  DEFAULT_RISK_PROFILE,
  RISK_DEFAULTS,
  mergeRiskProfile,
  type AccountType,
  type CanonicalSymbol,
} from "@market-sentinel/domain";
import { EtoroRestClient, isInsufficientPermissions } from "@market-sentinel/etoro-client";
import { createLogger } from "@market-sentinel/observability";
import {
  computeAccountTotals,
  cooldownUntil,
  dailyPnl,
  decimalOrZero,
  displayPositions,
  identityChanged,
  isBlackoutActive,
  isUsablePnlSnapshot,
  lastLosingClose,
  minDateString,
  nextConsecutiveLosses,
  normalizeHistoryItem,
  normalizePnlPosition,
  realizedDailyPnl,
  scoreRiskSnapshot,
  tradingStatusFromFlags,
  type BrokerPosition,
  type BrokerTrade,
  type EconomicEvent,
  type ScoreRiskSnapshot,
} from "@market-sentinel/risk-engine";
import { and, eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { maybeAlertPositionChange, maybeAlertRiskLimit, publishDomainEvent } from "./alert-store.js";
import { reconcileJournal } from "./journal-store.js";
import type { TelegramCredentials } from "./alert-store.js";

const logger = createLogger("worker-account");
const RISK_STATE_ID = "default";

export type AccountSyncContext = {
  db: Database;
  redis: Redis;
  rest: EtoroRestClient;
  accountType: "real" | "demo";
  telegram?: TelegramCredentials;
  now?: Date;
  force?: boolean;
};

function sourceAccount(args: { accountType: "real" | "demo" }): AccountType {
  return args.accountType === "demo" ? "DEMO" : "REAL";
}

export async function readScoreRisk(args: { redis: Redis }): Promise<ScoreRiskSnapshot | undefined> {
  const raw = await args.redis.get(REDIS_KEYS.risk);
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as {
      dailyLossHit?: boolean;
      consecutiveLossHit?: boolean;
      cooldownActive?: boolean;
      newsBlackout?: boolean;
    };
    return {
      dailyLossHit: Boolean(parsed.dailyLossHit),
      consecutiveLossHit: Boolean(parsed.consecutiveLossHit),
      cooldownActive: Boolean(parsed.cooldownActive),
      newsBlackout: Boolean(parsed.newsBlackout),
    };
  } catch {
    return undefined;
  }
}

export async function syncAccountAndRisk(args: AccountSyncContext): Promise<void> {
  const now = args.now ?? new Date();
  if (!args.force) {
    const last = await args.redis.get(REDIS_KEYS.lastAccountSyncAt);
    if (last && now.getTime() - new Date(last).getTime() < RISK_DEFAULTS.syncDebounceMs) {
      return;
    }
  }
  const started = Date.now();
  try {
    const { data } = await args.rest.getAccountPnl();
    if (!isUsablePnlSnapshot({ portfolio: data.clientPortfolio })) {
      throw new Error("unusable pnl snapshot");
    }
    const totals = computeAccountTotals({ portfolio: data.clientPortfolio });
    const symbolById = await loadSymbolMap({ db: args.db });
    const positions = displayPositions({ portfolio: data.clientPortfolio })
      .map((position) =>
        normalizePnlPosition({
          position,
          symbol: typeof position.instrumentID === "number" ? symbolById.get(position.instrumentID) ?? null : null,
        }),
      )
      .filter((item): item is BrokerPosition => item !== null);

    const snapshotId = randomUUID();
    const accountType = sourceAccount({ accountType: args.accountType });

    const previous = await args.db.select().from(brokerPositions);
    await reconcilePositions({
      db: args.db,
      redis: args.redis,
      telegram: args.telegram,
      previous,
      next: positions,
      rawById: new Map(
        (data.clientPortfolio?.positions ?? []).map((item) => [String(item.positionID ?? ""), item] as const),
      ),
      now,
    });

    let historyUnavailable = false;
    try {
      await syncHistory({
        rest: args.rest,
        db: args.db,
        symbolById,
        sourceAccount: accountType,
        now,
      });
    } catch (error) {
      if (isInsufficientPermissions({ error })) {
        historyUnavailable = true;
        logger.warn({ accountType }, "trade history unavailable (InsufficientPermissions)");
      } else {
        throw error;
      }
    }

    const trades = await loadTrades({ db: args.db });
    const events = await loadEvents({ db: args.db });
    const settingsRows = await args.db.select().from(appSettings).where(eq(appSettings.id, "default")).limit(1);
    const profile = mergeRiskProfile({ raw: settingsRows[0]?.riskJson ?? DEFAULT_RISK_PROFILE });
    const existingState = await args.db.select().from(riskState).where(eq(riskState.id, RISK_STATE_ID)).limit(1);
    const daily = dailyPnl({ trades, unrealizedPnl: totals.unrealizedPnl, now });
    const realized = realizedDailyPnl({ trades, now }).toString();
    const consecutiveLosses = nextConsecutiveLosses({ closedTrades: trades });
    const lastLossAt = lastLosingClose({ closedTrades: trades });
    const newsBlackout = isBlackoutActive({ events, now });
    const until = cooldownUntil({
      lastLossAt,
      minutes: profile.cooldownAfterLossMinutes,
      manualUntil: existingState[0]?.manualCooldownUntil ?? null,
    });
    const cooldownActive = Boolean(until && until.getTime() > now.getTime());
    const snapshot = scoreRiskSnapshot({
      profile,
      equity: totals.equity,
      dailyPnl: daily,
      consecutiveLosses,
      cooldownUntil: until,
      newsBlackout,
      now,
    });
    const tradingStatus = tradingStatusFromFlags({
      newsBlackout,
      sessionBlocked: snapshot.dailyLossHit || snapshot.consecutiveLossHit,
      cooldownActive,
    });

    await args.db.insert(accountSnapshots).values({
      id: snapshotId,
      timestamp: now,
      accountType,
      equity: totals.equity,
      cash: totals.cash,
      availableCash: totals.availableCash,
      invested: totals.invested,
      unrealizedPnl: totals.unrealizedPnl,
      realizedDailyPnl: realized,
      openPositionCount: positions.length,
      rawPayloadJson: data,
    });

    await upsertRiskState({
      db: args.db,
      consecutiveLosses,
      lastLossAt,
      cooldownUntil: until,
      manualCooldownUntil: existingState[0]?.manualCooldownUntil ?? null,
      dailyPnl: daily,
      tradingStatus,
      historyUnavailable,
      lastSyncAt: now,
      lastSyncLatencyMs: Date.now() - started,
      syncErrorCount: 0,
    });

    const accountPayload: AccountResponse = {
      available: true,
      accountType,
      equity: totals.equity,
      cash: totals.cash,
      availableCash: totals.availableCash,
      invested: totals.invested,
      unrealizedPnl: totals.unrealizedPnl,
      realizedDailyPnl: realized,
      openPositionCount: positions.length,
      historyUnavailable,
      capturedAt: now.toISOString(),
    };
    const riskPayload: RiskStatus = {
      available: true,
      tradingStatus,
      equity: totals.equity,
      dailyPnl: daily,
      riskRemainingUsd: remainingRisk({ equity: totals.equity, dailyPnl: daily, maxDailyLossPct: profile.maxDailyLossPct }),
      consecutiveLosses,
      cooldownUntil: until?.toISOString() ?? null,
      newsBlackout,
      historyUnavailable,
      lastSyncAt: now.toISOString(),
      lastSyncLatencyMs: Date.now() - started,
      syncErrorCount: 0,
      profile,
    };
    await args.redis.set(REDIS_KEYS.account, JSON.stringify(accountPayload));
    await args.redis.set(
      REDIS_KEYS.risk,
      JSON.stringify({
        ...riskPayload,
        ...snapshot,
      }),
    );
    await args.redis.set(REDIS_KEYS.positions, JSON.stringify(positions));
    await args.redis.set(REDIS_KEYS.lastAccountSyncAt, now.toISOString());
    await publishDomainEvent({ redis: args.redis, event: { type: "account", payload: accountPayload } });
    await publishDomainEvent({ redis: args.redis, event: { type: "risk", payload: riskPayload } });
    await args.db.insert(auditLogs).values({
      id: randomUUID(),
      eventType: "ACCOUNT_SYNCED",
      payloadJson: { snapshotId, equity: totals.equity, openPositionCount: positions.length, historyUnavailable },
    });
    await maybeAlertRiskLimit({
      db: args.db,
      redis: args.redis,
      telegram: args.telegram,
      previousStatus: existingState[0]?.tradingStatus ?? "ACTIVE",
      nextStatus: tradingStatus,
      dailyPnl: daily,
      consecutiveLosses,
    });
    await reconcileJournal({ db: args.db, redis: args.redis, now }).catch((journalError) => {
      logger.warn({ err: journalError }, "journal reconcile skipped");
    });
  } catch (error) {
    logger.warn({ err: error }, "account sync failed");
    await bumpSyncError({ db: args.db }).catch((bumpError) => {
      logger.warn({ err: bumpError }, "account sync error counter unavailable");
    });
  }
}

function remainingRisk(args: { equity: string | null; dailyPnl: string; maxDailyLossPct: number }): string | null {
  if (!args.equity) {
    return null;
  }
  return decimalOrZero({ value: args.equity })
    .times(args.maxDailyLossPct)
    .dividedBy(100)
    .plus(decimalOrZero({ value: args.dailyPnl }))
    .toString();
}

async function loadSymbolMap(args: { db: Database }): Promise<Map<number, CanonicalSymbol>> {
  const rows = await args.db.select().from(instruments);
  const map = new Map<number, CanonicalSymbol>();
  for (const row of rows) {
    if (typeof row.etoroInstrumentId === "number") {
      map.set(row.etoroInstrumentId, row.canonicalSymbol as CanonicalSymbol);
    }
  }
  return map;
}

async function loadTrades(args: { db: Database }): Promise<BrokerTrade[]> {
  const rows = await args.db.select().from(brokerTrades);
  return rows.map((row) => ({
    etoroPositionId: row.etoroPositionId,
    instrumentId: row.instrumentId,
    symbol: row.symbol,
    direction: row.direction as BrokerTrade["direction"],
    openedAt: row.openedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    openPrice: row.openPrice,
    closePrice: row.closePrice,
    units: row.units,
    investedAmount: row.investedAmount,
    leverage: row.leverage,
    stopLoss: row.stopLoss,
    takeProfit: row.takeProfit,
    realizedPnl: row.realizedPnl,
    fees: row.fees,
    sourceAccount: row.sourceAccount as BrokerTrade["sourceAccount"],
  }));
}

async function loadEvents(args: { db: Database }): Promise<EconomicEvent[]> {
  const rows = await args.db.select().from(economicEvents);
  return rows.map((row) => ({
    id: row.id,
    eventName: row.eventName,
    currency: row.currency,
    impact: row.impact as EconomicEvent["impact"],
    scheduledAtUtc: row.scheduledAtUtc,
    blackoutBeforeMinutes: row.blackoutBeforeMinutes,
    blackoutAfterMinutes: row.blackoutAfterMinutes,
  }));
}

async function syncHistory(args: {
  rest: EtoroRestClient;
  db: Database;
  symbolById: Map<number, CanonicalSymbol>;
  sourceAccount: AccountType;
  now: Date;
}): Promise<void> {
  const minDate = minDateString({ now: args.now, lookbackDays: RISK_DEFAULTS.historyLookbackDays });
  let page = 1;
  for (;;) {
    const { items } = await args.rest.getTradeHistory({ minDate, page, pageSize: 100 });
    if (items.length === 0) {
      break;
    }
    for (const item of items) {
      const trade = normalizeHistoryItem({
        item,
        symbol: typeof item.instrumentId === "number" ? args.symbolById.get(item.instrumentId) ?? null : null,
        sourceAccount: args.sourceAccount,
      });
      if (!trade) {
        continue;
      }
      await upsertTrade({ db: args.db, trade, raw: item });
    }
    if (items.length < 100) {
      break;
    }
    page += 1;
  }
}

async function upsertTrade(args: { db: Database; trade: BrokerTrade; raw: unknown }): Promise<void> {
  const existing = await args.db
    .select()
    .from(brokerTrades)
    .where(
      and(eq(brokerTrades.etoroPositionId, args.trade.etoroPositionId), eq(brokerTrades.sourceAccount, args.trade.sourceAccount)),
    )
    .limit(1);
  const openedAt = args.trade.openedAt ? new Date(args.trade.openedAt) : null;
  const closedAt = args.trade.closedAt ? new Date(args.trade.closedAt) : null;
  if (existing[0]) {
    if (
      identityChanged({
        previous: {
          openPrice: existing[0].openPrice,
          units: existing[0].units,
          openedAt: existing[0].openedAt?.toISOString() ?? null,
        },
        next: { openPrice: args.trade.openPrice, units: args.trade.units, openedAt: args.trade.openedAt },
      })
    ) {
      await args.db.insert(auditLogs).values({
        id: randomUUID(),
        eventType: "RECONCILIATION_CONFLICT",
        payloadJson: { kind: "trade", etoroPositionId: args.trade.etoroPositionId },
      });
      return;
    }
    await args.db
      .update(brokerTrades)
      .set({
        closedAt,
        closePrice: args.trade.closePrice,
        realizedPnl: args.trade.realizedPnl,
        fees: args.trade.fees,
        rawBrokerPayloadJson: args.raw,
        updatedAt: new Date(),
      })
      .where(eq(brokerTrades.id, existing[0].id));
    return;
  }
  await args.db.insert(brokerTrades).values({
    id: randomUUID(),
    etoroPositionId: args.trade.etoroPositionId,
    instrumentId: args.trade.instrumentId,
    symbol: args.trade.symbol,
    direction: args.trade.direction,
    openedAt,
    closedAt,
    openPrice: args.trade.openPrice,
    closePrice: args.trade.closePrice,
    units: args.trade.units,
    investedAmount: args.trade.investedAmount,
    leverage: args.trade.leverage,
    stopLoss: args.trade.stopLoss,
    takeProfit: args.trade.takeProfit,
    realizedPnl: args.trade.realizedPnl,
    fees: args.trade.fees,
    sourceAccount: args.trade.sourceAccount,
    rawBrokerPayloadJson: args.raw,
  });
}

async function reconcilePositions(args: {
  db: Database;
  redis: Redis;
  telegram?: TelegramCredentials;
  previous: Array<typeof brokerPositions.$inferSelect>;
  next: BrokerPosition[];
  rawById: Map<string, unknown>;
  now: Date;
}): Promise<void> {
  const previousById = new Map(args.previous.map((row) => [row.etoroPositionId, row]));
  const nextIds = new Set(args.next.map((item) => item.etoroPositionId));
  for (const position of args.next) {
    const existing = previousById.get(position.etoroPositionId);
    const openedAt = position.openedAt ? new Date(position.openedAt) : null;
    if (existing) {
      if (
        identityChanged({
          previous: {
            openPrice: existing.openPrice,
            units: existing.units,
            openedAt: existing.openedAt?.toISOString() ?? null,
          },
          next: { openPrice: position.openPrice, units: position.units, openedAt: position.openedAt },
        })
      ) {
        await args.db.insert(auditLogs).values({
          id: randomUUID(),
          eventType: "RECONCILIATION_CONFLICT",
          instrumentId: existing.symbol,
          payloadJson: { kind: "position", etoroPositionId: position.etoroPositionId },
        });
        continue;
      }
      await args.db
        .update(brokerPositions)
        .set({
          investedAmount: position.investedAmount,
          unrealizedPnl: position.unrealizedPnl,
          stopLoss: position.stopLoss,
          takeProfit: position.takeProfit,
          fees: position.fees,
          symbol: position.symbol,
          rawPayloadJson: args.rawById.get(position.etoroPositionId) ?? existing.rawPayloadJson,
          syncedAt: args.now,
        })
        .where(eq(brokerPositions.id, existing.id));
      continue;
    }
    await args.db.insert(brokerPositions).values({
      id: randomUUID(),
      etoroPositionId: position.etoroPositionId,
      instrumentId: position.instrumentId,
      symbol: position.symbol,
      direction: position.direction,
      openedAt,
      openPrice: position.openPrice,
      units: position.units,
      investedAmount: position.investedAmount,
      leverage: position.leverage,
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit,
      unrealizedPnl: position.unrealizedPnl,
      fees: position.fees,
      mirrorId: position.mirrorId,
      rawPayloadJson: args.rawById.get(position.etoroPositionId) ?? {},
      syncedAt: args.now,
    });
    await args.db.insert(auditLogs).values({
      id: randomUUID(),
      eventType: "POSITION_OPENED",
      instrumentId: position.symbol,
      payloadJson: { etoroPositionId: position.etoroPositionId, symbol: position.symbol },
    });
    await maybeAlertPositionChange({
      db: args.db,
      redis: args.redis,
      telegram: args.telegram,
      type: "POSITION_DETECTED",
      symbol: position.symbol ?? "UNKNOWN",
      etoroPositionId: position.etoroPositionId,
      direction: position.direction,
    });
  }
  for (const existing of args.previous) {
    if (nextIds.has(existing.etoroPositionId)) {
      continue;
    }
    await args.db.delete(brokerPositions).where(eq(brokerPositions.id, existing.id));
    await args.db.insert(auditLogs).values({
      id: randomUUID(),
      eventType: "POSITION_CLOSED",
      instrumentId: existing.symbol,
      payloadJson: { etoroPositionId: existing.etoroPositionId, symbol: existing.symbol },
    });
    await maybeAlertPositionChange({
      db: args.db,
      redis: args.redis,
      telegram: args.telegram,
      type: "POSITION_CLOSED",
      symbol: existing.symbol ?? "UNKNOWN",
      etoroPositionId: existing.etoroPositionId,
      direction: existing.direction,
    });
  }
}

async function upsertRiskState(args: {
  db: Database;
  consecutiveLosses: number;
  lastLossAt: Date | null;
  cooldownUntil: Date | null;
  manualCooldownUntil: Date | null;
  dailyPnl: string;
  tradingStatus: string;
  historyUnavailable: boolean;
  lastSyncAt: Date;
  lastSyncLatencyMs: number;
  syncErrorCount: number;
}): Promise<void> {
  const values = {
    consecutiveLosses: args.consecutiveLosses,
    lastLossAt: args.lastLossAt,
    cooldownUntil: args.cooldownUntil,
    manualCooldownUntil: args.manualCooldownUntil,
    dailyPnl: args.dailyPnl,
    tradingStatus: args.tradingStatus,
    historyUnavailable: args.historyUnavailable,
    lastSyncAt: args.lastSyncAt,
    lastSyncLatencyMs: args.lastSyncLatencyMs,
    syncErrorCount: args.syncErrorCount,
    updatedAt: new Date(),
  };
  const existing = await args.db.select().from(riskState).where(eq(riskState.id, RISK_STATE_ID)).limit(1);
  if (existing[0]) {
    await args.db.update(riskState).set(values).where(eq(riskState.id, RISK_STATE_ID));
    return;
  }
  await args.db.insert(riskState).values({ id: RISK_STATE_ID, ...values });
}

async function bumpSyncError(args: { db: Database }): Promise<void> {
  const existing = await args.db.select().from(riskState).where(eq(riskState.id, RISK_STATE_ID)).limit(1);
  if (!existing[0]) {
    return;
  }
  await args.db
    .update(riskState)
    .set({ syncErrorCount: existing[0].syncErrorCount + 1, updatedAt: new Date() })
    .where(eq(riskState.id, RISK_STATE_ID));
}

export async function loadApprovedPlans(args: { db: Database }) {
  return args.db.select().from(tradePlans).where(eq(tradePlans.gateStatus, "APPROVED"));
}
