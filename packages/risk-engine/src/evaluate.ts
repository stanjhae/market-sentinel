import {
  PSYCHOLOGY_CHECKLIST_KEYS,
  type PsychologyChecklist,
  type RiskProfile,
  type TradingStatus,
} from "@market-sentinel/domain";
import { Decimal } from "decimal.js";
import { decimalOrZero, decimalString } from "./money.js";
import {
  activeBlackoutEvent,
  cooldownUntil,
  correlatedExposureCount,
  dailyLossHit,
  dailyPnl,
  lastApprovedRiskPct,
  lastLosingClose,
  nextConsecutiveLosses,
} from "./session.js";
import type {
  BrokerPosition,
  BrokerTrade,
  ChecklistResult,
  EconomicEvent,
  OpenPlanExposure,
  RiskEvaluation,
  RiskPlanInput,
  ScoreRiskSnapshot,
} from "./types.js";

export function tradingStatusFromFlags(args: {
  newsBlackout: boolean;
  sessionBlocked: boolean;
  cooldownActive: boolean;
}): TradingStatus {
  if (args.newsBlackout) {
    return "NEWS_BLACKOUT";
  }
  if (args.sessionBlocked) {
    return "SESSION_BLOCKED";
  }
  if (args.cooldownActive) {
    return "COOLDOWN";
  }
  return "ACTIVE";
}

export function evaluateChecklist(args: { checklist: PsychologyChecklist | null }): ChecklistResult {
  if (!args.checklist) {
    return { complete: false, missing: [...PSYCHOLOGY_CHECKLIST_KEYS] };
  }
  const missing = PSYCHOLOGY_CHECKLIST_KEYS.filter((key) => args.checklist?.[key] !== true);
  return { complete: missing.length === 0, missing };
}

export function evaluateRisk(args: {
  profile: RiskProfile;
  equity: string | null;
  unrealizedPnl: string | null;
  trades: BrokerTrade[];
  positions: BrokerPosition[];
  plans: OpenPlanExposure[];
  events: EconomicEvent[];
  plan: RiskPlanInput;
  now: Date;
  manualCooldownUntil?: Date | null;
}): RiskEvaluation {
  const realizedUnrealized = dailyPnl({
    trades: args.trades,
    unrealizedPnl: args.unrealizedPnl,
    now: args.now,
  });
  const consecutiveLosses = nextConsecutiveLosses({ closedTrades: args.trades });
  const lastLossAt = lastLosingClose({ closedTrades: args.trades });
  const until = cooldownUntil({
    lastLossAt,
    minutes: args.profile.cooldownAfterLossMinutes,
    manualUntil: args.manualCooldownUntil ?? null,
  });
  const newsBlackout = Boolean(activeBlackoutEvent({ events: args.events, now: args.now }));
  const cooldownActive = Boolean(until && until.getTime() > args.now.getTime());
  const dailyHit = dailyLossHit({ dailyPnl: realizedUnrealized, equity: args.equity, profile: args.profile });
  const consecutiveHit = consecutiveLosses >= args.profile.maxConsecutiveLosses;
  const sessionBlocked = dailyHit || consecutiveHit;
  const tradingStatus = tradingStatusFromFlags({
    newsBlackout,
    sessionBlocked,
    cooldownActive,
  });

  const blockReasons: string[] = [];
  if (!args.equity) {
    blockReasons.push("insufficient-account");
  }
  if (dailyHit) {
    blockReasons.push("daily-loss");
  }
  if (consecutiveHit) {
    blockReasons.push("consecutive-loss");
  }
  if (cooldownActive) {
    blockReasons.push("cooldown");
  }
  if (newsBlackout) {
    blockReasons.push("news-blackout");
  }
  const exposure = correlatedExposureCount({
    symbol: args.plan.symbol,
    positions: args.positions,
    plans: args.plans,
  });
  if (exposure >= args.profile.maxConcurrentCorrelatedPositions) {
    blockReasons.push("correlated-exposure");
  }

  const requestedPct = args.plan.riskPct
    ? decimalOrZero({ value: args.plan.riskPct })
    : new Decimal(args.profile.maxRiskPerTradePct);
  const maxPct = new Decimal(args.profile.maxRiskPerTradePct);
  if (requestedPct.gt(maxPct)) {
    blockReasons.push("risk-pct-exceeds-max");
  }
  const lastPct = lastApprovedRiskPct({ plans: args.plans });
  const lastLost = Boolean(lastLossAt);
  if (lastLost && args.profile.prohibitRiskIncreaseAfterLoss && lastPct && requestedPct.gt(lastPct)) {
    blockReasons.push("risk-increase-after-loss");
  }
  if (lastLost && args.profile.prohibitMartingale && lastPct && requestedPct.gt(lastPct)) {
    blockReasons.push("martingale");
  }

  const entry = args.plan.plannedEntry ? decimalOrZero({ value: args.plan.plannedEntry }) : null;
  const stop = args.plan.stopLoss ? decimalOrZero({ value: args.plan.stopLoss }) : null;
  if (!entry || !stop || entry.eq(stop)) {
    blockReasons.push("missing-stop");
  }
  if (args.plan.riskRewardToT1 && decimalOrZero({ value: args.plan.riskRewardToT1 }).lt(args.profile.minimumRewardRisk)) {
    blockReasons.push("rr-below-minimum");
  }

  const riskPct = Decimal.min(requestedPct, maxPct);
  const maxLossUsd = args.equity ? decimalOrZero({ value: args.equity }).times(riskPct).dividedBy(100) : null;
  const stopDistance = entry && stop ? entry.minus(stop).abs() : null;
  const positionSizeUsd =
    maxLossUsd && entry && stopDistance && !stopDistance.isZero()
      ? maxLossUsd.times(entry).dividedBy(stopDistance)
      : null;
  const minTarget =
    entry && stopDistance
      ? args.plan.direction === "SHORT"
        ? entry.minus(stopDistance.times(args.profile.minimumRewardRisk))
        : entry.plus(stopDistance.times(args.profile.minimumRewardRisk))
      : null;
  const expectedR =
    args.plan.riskRewardToT1 ??
    (args.plan.target1 && entry && stopDistance && !stopDistance.isZero()
      ? decimalOrZero({ value: args.plan.target1 }).minus(entry).abs().dividedBy(stopDistance).toString()
      : null);

  return {
    allowed: blockReasons.length === 0,
    blockReasons,
    tradingStatus,
    maxLossUsd: maxLossUsd ? decimalString({ value: maxLossUsd }) : null,
    maxRiskPct: decimalString({ value: maxPct }),
    positionSizeUsd: positionSizeUsd ? decimalString({ value: positionSizeUsd }) : null,
    minTarget: minTarget ? decimalString({ value: minTarget }) : null,
    expectedR,
    dailyPnl: realizedUnrealized,
    consecutiveLosses,
    cooldownUntil: until,
    newsBlackout,
  };
}

export function scoreRiskSnapshot(args: {
  profile: RiskProfile;
  equity: string | null;
  dailyPnl: string;
  consecutiveLosses: number;
  cooldownUntil: Date | null;
  newsBlackout: boolean;
  now: Date;
}): ScoreRiskSnapshot {
  return {
    dailyLossHit: dailyLossHit({ dailyPnl: args.dailyPnl, equity: args.equity, profile: args.profile }),
    consecutiveLossHit: args.consecutiveLosses >= args.profile.maxConsecutiveLosses,
    cooldownActive: Boolean(args.cooldownUntil && args.cooldownUntil.getTime() > args.now.getTime()),
    newsBlackout: args.newsBlackout,
  };
}
