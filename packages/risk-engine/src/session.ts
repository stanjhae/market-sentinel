import { correlationBucket, type RiskProfile } from "@market-sentinel/domain";
import { Decimal } from "decimal.js";
import { addMinutes, decimalOrZero, utcDayStart } from "./money.js";
import type { BrokerPosition, BrokerTrade, EconomicEvent, OpenPlanExposure } from "./types.js";

export function realizedDailyPnl(args: { trades: BrokerTrade[]; now: Date }): Decimal {
  const start = utcDayStart({ now: args.now }).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  return args.trades.reduce((sum, trade) => {
    if (!trade.closedAt) {
      return sum;
    }
    const closed = new Date(trade.closedAt).getTime();
    if (closed < start || closed >= end) {
      return sum;
    }
    return sum.plus(decimalOrZero({ value: trade.realizedPnl }));
  }, new Decimal(0));
}

export function dailyPnl(args: { trades: BrokerTrade[]; unrealizedPnl: string | null; now: Date }): string {
  return realizedDailyPnl({ trades: args.trades, now: args.now })
    .plus(decimalOrZero({ value: args.unrealizedPnl }))
    .toString();
}

export function nextConsecutiveLosses(args: { closedTrades: BrokerTrade[] }): number {
  const ordered = [...args.closedTrades]
    .filter((trade) => trade.closedAt)
    .sort((left, right) => new Date(left.closedAt ?? 0).getTime() - new Date(right.closedAt ?? 0).getTime());
  let streak = 0;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const pnl = decimalOrZero({ value: ordered[index]?.realizedPnl });
    if (pnl.isZero()) {
      continue;
    }
    if (pnl.isNegative()) {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

export function lastLosingClose(args: { closedTrades: BrokerTrade[] }): Date | null {
  const ordered = [...args.closedTrades]
    .filter((trade) => trade.closedAt)
    .sort((left, right) => new Date(left.closedAt ?? 0).getTime() - new Date(right.closedAt ?? 0).getTime());
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const trade = ordered[index];
    if (!trade) {
      continue;
    }
    if (decimalOrZero({ value: trade.realizedPnl }).isNegative() && trade.closedAt) {
      return new Date(trade.closedAt);
    }
    if (decimalOrZero({ value: trade.realizedPnl }).isPositive()) {
      return null;
    }
  }
  return null;
}

export function cooldownUntil(args: {
  lastLossAt: Date | null;
  minutes: number;
  manualUntil: Date | null;
}): Date | null {
  const automatic = args.lastLossAt ? addMinutes({ at: args.lastLossAt, minutes: args.minutes }) : null;
  if (!automatic && !args.manualUntil) {
    return null;
  }
  if (!automatic) {
    return args.manualUntil;
  }
  if (!args.manualUntil) {
    return automatic;
  }
  return automatic.getTime() > args.manualUntil.getTime() ? automatic : args.manualUntil;
}

export function isBlackoutActive(args: { events: EconomicEvent[]; now: Date }): boolean {
  return args.events.some((event) => {
    const start = addMinutes({ at: event.scheduledAtUtc, minutes: -event.blackoutBeforeMinutes });
    const end = addMinutes({ at: event.scheduledAtUtc, minutes: event.blackoutAfterMinutes });
    return args.now.getTime() >= start.getTime() && args.now.getTime() < end.getTime();
  });
}

export function activeBlackoutEvent(args: { events: EconomicEvent[]; now: Date }): EconomicEvent | null {
  return args.events.find((event) => isBlackoutActive({ events: [event], now: args.now })) ?? null;
}

export function isOpenApprovedPlan(args: { plan: OpenPlanExposure }): boolean {
  if (args.plan.gateStatus !== "APPROVED" || !args.plan.symbol) {
    return false;
  }
  if (args.plan.signalState != null && args.plan.signalState !== "TRADE_PLANNED") {
    return false;
  }
  return true;
}

export function correlatedExposureCount(args: {
  symbol: string;
  positions: Array<Pick<BrokerPosition, "symbol">>;
  plans: OpenPlanExposure[];
}): number {
  const bucket = correlationBucket({ symbol: args.symbol });
  const positionCount = args.positions.filter((position) => {
    if (!position.symbol) {
      return false;
    }
    const other = correlationBucket({ symbol: position.symbol });
    return bucket === "OTHER" ? position.symbol === args.symbol : other === bucket;
  }).length;
  const planCount = args.plans.filter((plan) => {
    if (!isOpenApprovedPlan({ plan })) {
      return false;
    }
    const other = correlationBucket({ symbol: plan.symbol ?? "" });
    return bucket === "OTHER" ? plan.symbol === args.symbol : other === bucket;
  }).length;
  return positionCount + planCount;
}

export function lastApprovedRiskPct(args: { plans: OpenPlanExposure[] }): Decimal | null {
  const approved = args.plans
    .filter((plan) => isOpenApprovedPlan({ plan }) && plan.riskPct)
    .sort((left, right) => {
      const leftAt = left.approvedAt ? new Date(left.approvedAt).getTime() : 0;
      const rightAt = right.approvedAt ? new Date(right.approvedAt).getTime() : 0;
      return leftAt - rightAt;
    });
  const last = approved[approved.length - 1];
  if (!last?.riskPct) {
    return null;
  }
  return decimalOrZero({ value: last.riskPct });
}

export function dailyLossHit(args: { dailyPnl: string; equity: string | null; profile: RiskProfile }): boolean {
  if (!args.equity) {
    return false;
  }
  const equity = decimalOrZero({ value: args.equity });
  if (equity.lte(0)) {
    return true;
  }
  const budget = equity.times(args.profile.maxDailyLossPct).dividedBy(100).negated();
  return decimalOrZero({ value: args.dailyPnl }).lte(budget);
}
