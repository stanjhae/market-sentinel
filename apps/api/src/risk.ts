import type { RiskEvaluationDto, RiskStatus } from "@market-sentinel/contracts";
import { REDIS_KEYS } from "@market-sentinel/contracts";
import {
  accountSnapshots,
  appSettings,
  brokerPositions,
  brokerTrades,
  economicEvents,
  riskState,
  signals,
  tradePlans,
  type Database,
} from "@market-sentinel/db";
import { DEFAULT_RISK_PROFILE, mergeRiskProfile, type PsychologyChecklist } from "@market-sentinel/domain";
import {
  evaluateChecklist,
  evaluateRisk,
  isBlackoutActive,
  tradingStatusFromFlags,
  type BrokerPosition,
  type BrokerTrade,
  type EconomicEvent,
  type OpenPlanExposure,
  type RiskPlanInput,
} from "@market-sentinel/risk-engine";
import { desc, eq } from "drizzle-orm";
import { Redis } from "ioredis";

const RISK_STATE_ID = "default";

export function emptyRiskStatus(): RiskStatus {
  return {
    available: false,
    tradingStatus: "ACTIVE",
    equity: null,
    dailyPnl: null,
    riskRemainingUsd: null,
    consecutiveLosses: 0,
    cooldownUntil: null,
    newsBlackout: false,
    historyUnavailable: false,
    lastSyncAt: null,
    lastSyncLatencyMs: null,
    syncErrorCount: 0,
    profile: DEFAULT_RISK_PROFILE,
  };
}

export async function readRiskStatus(args: { db: Database; redis: Redis }): Promise<RiskStatus> {
  const events = await args.db.select().from(economicEvents);
  const newsBlackout = isBlackoutActive({
    events: events.map(toEvent),
    now: new Date(),
  });
  const raw = await args.redis.get(REDIS_KEYS.risk);
  if (raw) {
    try {
      const cached = JSON.parse(raw) as Partial<RiskStatus> & {
        dailyLossHit?: boolean;
        consecutiveLossHit?: boolean;
        cooldownActive?: boolean;
      };
      const cooldownActive = Boolean(
        cached.cooldownActive ||
          (cached.cooldownUntil && new Date(cached.cooldownUntil).getTime() > Date.now()),
      );
      const sessionBlocked = Boolean(
        cached.dailyLossHit || cached.consecutiveLossHit || cached.tradingStatus === "SESSION_BLOCKED",
      );
      return {
        ...emptyRiskStatus(),
        ...cached,
        available: true,
        newsBlackout,
        tradingStatus: tradingStatusFromFlags({ newsBlackout, sessionBlocked, cooldownActive }),
      };
    } catch {
      // fall through to postgres
    }
  }
  const [state, settings] = await Promise.all([
    args.db.select().from(riskState).where(eq(riskState.id, RISK_STATE_ID)).limit(1),
    args.db.select().from(appSettings).where(eq(appSettings.id, "default")).limit(1),
  ]);
  const profile = mergeRiskProfile({ raw: settings[0]?.riskJson ?? DEFAULT_RISK_PROFILE });
  const row = state[0];
  if (!row) {
    return {
      ...emptyRiskStatus(),
      available: true,
      profile,
      newsBlackout,
      tradingStatus: newsBlackout ? "NEWS_BLACKOUT" : "ACTIVE",
    };
  }
  return {
    available: true,
    tradingStatus: tradingStatusFromFlags({
      newsBlackout,
      sessionBlocked: row.tradingStatus === "SESSION_BLOCKED",
      cooldownActive: Boolean(row.cooldownUntil && row.cooldownUntil.getTime() > Date.now()),
    }),
    equity: null,
    dailyPnl: row.dailyPnl,
    riskRemainingUsd: null,
    consecutiveLosses: row.consecutiveLosses,
    cooldownUntil: row.cooldownUntil?.toISOString() ?? null,
    newsBlackout,
    historyUnavailable: row.historyUnavailable,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastSyncLatencyMs: row.lastSyncLatencyMs,
    syncErrorCount: row.syncErrorCount,
    profile,
  };
}

export async function evaluateStoredPlan(args: {
  db: Database;
  plan: RiskPlanInput;
  now?: Date;
}): Promise<RiskEvaluationDto> {
  const context = await loadRiskContext({ db: args.db });
  const evaluation = evaluateRisk({
    profile: context.profile,
    equity: context.equity,
    unrealizedPnl: context.unrealizedPnl,
    trades: context.trades,
    positions: context.positions,
    plans: context.plans,
    events: context.events,
    plan: args.plan,
    now: args.now ?? new Date(),
    manualCooldownUntil: context.manualCooldownUntil,
  });
  return {
    ...evaluation,
    cooldownUntil: evaluation.cooldownUntil?.toISOString() ?? null,
  };
}

export function checklistOrReject(args: { checklist: PsychologyChecklist | null }): ReturnType<typeof evaluateChecklist> {
  return evaluateChecklist({ checklist: args.checklist });
}

export async function setManualCooldown(args: { db: Database; until: Date }): Promise<void> {
  const existing = await args.db.select().from(riskState).where(eq(riskState.id, RISK_STATE_ID)).limit(1);
  if (existing[0]) {
    await args.db
      .update(riskState)
      .set({ manualCooldownUntil: args.until, cooldownUntil: args.until, updatedAt: new Date() })
      .where(eq(riskState.id, RISK_STATE_ID));
    return;
  }
  await args.db.insert(riskState).values({
    id: RISK_STATE_ID,
    consecutiveLosses: 0,
    lastLossAt: null,
    cooldownUntil: args.until,
    manualCooldownUntil: args.until,
    dailyPnl: "0",
    tradingStatus: "COOLDOWN",
    historyUnavailable: false,
    lastSyncAt: null,
    lastSyncLatencyMs: null,
    syncErrorCount: 0,
    updatedAt: new Date(),
  });
}

async function loadRiskContext(args: { db: Database }) {
  const [settings, state, positionRows, tradeRows, eventRows, planRows, snapshots] = await Promise.all([
    args.db.select().from(appSettings).where(eq(appSettings.id, "default")).limit(1),
    args.db.select().from(riskState).where(eq(riskState.id, RISK_STATE_ID)).limit(1),
    args.db.select().from(brokerPositions),
    args.db.select().from(brokerTrades),
    args.db.select().from(economicEvents),
    args.db.select().from(tradePlans),
    args.db.select().from(accountSnapshots).orderBy(desc(accountSnapshots.timestamp)).limit(1),
  ]);
  const signalRows = await args.db.select().from(signals);
  const signalById = new Map(signalRows.map((row) => [row.id, row]));
  return {
    profile: mergeRiskProfile({ raw: settings[0]?.riskJson ?? DEFAULT_RISK_PROFILE }),
    equity: snapshots[0]?.equity ?? null,
    unrealizedPnl: snapshots[0]?.unrealizedPnl ?? null,
    manualCooldownUntil: state[0]?.manualCooldownUntil ?? null,
    trades: tradeRows.map(
      (row): BrokerTrade => ({
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
      }),
    ),
    positions: positionRows.map(
      (row): BrokerPosition => ({
        etoroPositionId: row.etoroPositionId,
        instrumentId: row.instrumentId,
        symbol: row.symbol,
        direction: row.direction as BrokerPosition["direction"],
        openedAt: row.openedAt?.toISOString() ?? null,
        openPrice: row.openPrice,
        units: row.units,
        investedAmount: row.investedAmount,
        leverage: row.leverage,
        stopLoss: row.stopLoss,
        takeProfit: row.takeProfit,
        unrealizedPnl: row.unrealizedPnl,
        fees: row.fees,
        mirrorId: row.mirrorId,
      }),
    ),
    plans: planRows.flatMap((row): OpenPlanExposure[] => {
      const signal = signalById.get(row.signalId);
      if (!signal?.symbol) {
        return [];
      }
      return [
        {
          symbol: signal.symbol,
          gateStatus: row.gateStatus as OpenPlanExposure["gateStatus"],
          riskPct: row.riskPct,
          estimatedPositionSize: row.estimatedPositionSize,
          signalState: signal.state,
          approvedAt: row.approvedAt?.toISOString() ?? null,
        },
      ];
    }),
    events: eventRows.map(toEvent),
  };
}

function toEvent(row: typeof economicEvents.$inferSelect): EconomicEvent {
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
