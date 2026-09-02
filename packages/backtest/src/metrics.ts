import { analyticsFromTrades, decimalOrNull } from "@market-sentinel/journal";
import type { ClosedJournalTrade } from "@market-sentinel/journal";
import { Decimal } from "decimal.js";
import type { BacktestMetrics, SimulatedTrade } from "./types.js";

function toJournal(args: { trade: SimulatedTrade }): ClosedJournalTrade {
  return {
    closedAt: args.trade.closedAt ?? new Date(0),
    openedAt: args.trade.openedAt,
    symbol: null,
    direction: args.trade.direction,
    setupKey: `${args.trade.strategyKey}@${args.trade.strategyVersion}`,
    realizedPnl: args.trade.realizedPnl,
    fees: args.trade.fees,
    resultR: args.trade.resultR,
    maeUsd: args.trade.maeUsd,
    mfeUsd: args.trade.mfeUsd,
    matchStatus: "LINKED",
    followedPlan: true,
    ruleBreaks: [],
    alignedWithTrend: null,
  };
}

function streak(args: { trades: SimulatedTrade[]; wins: boolean }): number {
  let best = 0;
  let current = 0;
  for (const trade of args.trades) {
    const pnl = decimalOrNull({ value: trade.realizedPnl });
    if (!pnl) {
      continue;
    }
    const hit = args.wins ? pnl.greaterThan(0) : pnl.lessThan(0);
    current = hit ? current + 1 : 0;
    if (current > best) {
      best = current;
    }
  }
  return best;
}

export function metricsFromTrades(args: {
  trades: SimulatedTrade[];
  setupCount: number;
}): BacktestMetrics {
  const closed = args.trades
    .filter((trade) => trade.status === "closed" && trade.realizedPnl !== null)
    .slice()
    .sort((left, right) => (left.closedAt?.getTime() ?? 0) - (right.closedAt?.getTime() ?? 0));
  if (closed.length === 0) {
    return {
      empty: true,
      tradeCount: 0,
      setupCount: args.setupCount,
      winRate: null,
      expectancyR: null,
      profitFactor: null,
      maxDrawdown: null,
      averageR: null,
      averageMae: null,
      averageMfe: null,
      netPnl: null,
      timeInMarketBars: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
    };
  }
  const analytics = analyticsFromTrades({ trades: closed.map((trade) => toJournal({ trade })) });
  const withR = closed.map((trade) => decimalOrNull({ value: trade.resultR })).filter((value): value is Decimal => value !== null);
  const averageR =
    withR.length === 0
      ? null
      : withR.reduce((sum, value) => sum.plus(value), new Decimal(0)).dividedBy(withR.length).toString();
  const timeInMarketBars = closed.reduce((sum, trade) => {
    if (trade.entryBarIndex === null || trade.exitBarIndex === null) {
      return sum;
    }
    return sum + Math.max(0, trade.exitBarIndex - trade.entryBarIndex + 1);
  }, 0);
  return {
    empty: false,
    tradeCount: closed.length,
    setupCount: args.setupCount,
    winRate: analytics.summary?.winRate ?? null,
    expectancyR: analytics.summary?.expectancyR ?? null,
    profitFactor: analytics.summary?.profitFactor ?? null,
    maxDrawdown: analytics.summary?.maxDrawdown ?? null,
    averageR,
    averageMae: analytics.summary?.averageMae ?? null,
    averageMfe: analytics.summary?.averageMfe ?? null,
    netPnl: analytics.summary?.netPnl ?? null,
    timeInMarketBars,
    consecutiveWins: streak({ trades: closed, wins: true }),
    consecutiveLosses: streak({ trades: closed, wins: false }),
  };
}
