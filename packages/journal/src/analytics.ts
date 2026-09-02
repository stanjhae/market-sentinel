import { Decimal } from "decimal.js";
import { disciplineMeetsThreshold, disciplineScore } from "./discipline.js";
import { decimalOrNull, decimalString, optionalDecimalString } from "./money.js";
import type { AnalyticsResult, AnalyticsSummary, ClosedJournalTrade, MetricBucket, PsychologyAnalytics } from "./types.js";

function knownPnl(args: { trade: ClosedJournalTrade }): Decimal | null {
  return decimalOrNull({ value: args.trade.realizedPnl });
}

function resultROf(args: { trade: ClosedJournalTrade }): Decimal | null {
  return decimalOrNull({ value: args.trade.resultR });
}

function average(args: { values: Decimal[] }): Decimal | null {
  if (args.values.length === 0) {
    return null;
  }
  return args.values.reduce((sum, value) => sum.plus(value), new Decimal(0)).dividedBy(args.values.length);
}

function withKnownPnl(args: { trades: ClosedJournalTrade[] }): ClosedJournalTrade[] {
  return args.trades.filter((trade) => knownPnl({ trade }) !== null);
}

function winRate(args: { trades: ClosedJournalTrade[] }): Decimal | null {
  const known = withKnownPnl({ trades: args.trades });
  if (known.length === 0) {
    return null;
  }
  const wins = known.filter((trade) => knownPnl({ trade })!.greaterThan(0)).length;
  return new Decimal(wins).dividedBy(known.length);
}

function expectancyR(args: { trades: ClosedJournalTrade[] }): Decimal | null {
  const withR = args.trades.map((trade) => resultROf({ trade })).filter((value): value is Decimal => value !== null);
  if (withR.length === 0) {
    return null;
  }
  const wins = withR.filter((value) => value.greaterThan(0));
  const losses = withR.filter((value) => value.lessThanOrEqualTo(0));
  const pWin = new Decimal(wins.length).dividedBy(withR.length);
  const pLoss = new Decimal(losses.length).dividedBy(withR.length);
  const avgWin = average({ values: wins }) ?? new Decimal(0);
  const avgLoss = average({ values: losses.map((value) => value.abs()) }) ?? new Decimal(0);
  return pWin.times(avgWin).minus(pLoss.times(avgLoss));
}

function netPnl(args: { trades: ClosedJournalTrade[] }): Decimal {
  return withKnownPnl({ trades: args.trades }).reduce((sum, trade) => sum.plus(knownPnl({ trade })!), new Decimal(0));
}

function bucketOf(args: { key: string; trades: ClosedJournalTrade[] }): MetricBucket {
  return {
    key: args.key,
    count: args.trades.length,
    netPnl: args.trades.length === 0 ? null : decimalString({ value: netPnl({ trades: args.trades }) }),
    winRate: optionalDecimalString({ value: winRate({ trades: args.trades }) }),
    expectancyR: optionalDecimalString({ value: expectancyR({ trades: args.trades }) }),
  };
}

function groupBy(args: { trades: ClosedJournalTrade[]; keyOf: (trade: ClosedJournalTrade) => string }): MetricBucket[] {
  const groups = new Map<string, ClosedJournalTrade[]>();
  for (const trade of args.trades) {
    const key = args.keyOf(trade);
    const existing = groups.get(key) ?? [];
    existing.push(trade);
    groups.set(key, existing);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, trades]) => bucketOf({ key, trades }));
}

function splitStats(args: { trades: ClosedJournalTrade[] }): {
  count: number;
  netPnl: string;
  expectancyR: string | null;
  winRate: string | null;
} {
  return {
    count: args.trades.length,
    netPnl: decimalString({ value: netPnl({ trades: args.trades }) }),
    expectancyR: optionalDecimalString({ value: expectancyR({ trades: args.trades }) }),
    winRate: optionalDecimalString({ value: winRate({ trades: args.trades }) }),
  };
}

function maxDrawdown(args: { trades: ClosedJournalTrade[] }): Decimal {
  const ordered = [...args.trades].sort((left, right) => left.closedAt.getTime() - right.closedAt.getTime());
  let equity = new Decimal(0);
  let peak = new Decimal(0);
  let drawdown = new Decimal(0);
  for (const trade of ordered) {
    const pnl = knownPnl({ trade });
    if (!pnl) {
      continue;
    }
    equity = equity.plus(pnl);
    if (equity.greaterThan(peak)) {
      peak = equity;
    }
    const next = peak.minus(equity);
    if (next.greaterThan(drawdown)) {
      drawdown = next;
    }
  }
  return drawdown;
}

function buildSummary(args: { trades: ClosedJournalTrade[] }): AnalyticsSummary {
  const known = withKnownPnl({ trades: args.trades });
  const wins = known.filter((trade) => knownPnl({ trade })!.greaterThan(0));
  const losses = known.filter((trade) => knownPnl({ trade })!.lessThan(0));
  const winPnls = wins.map((trade) => knownPnl({ trade })!);
  const lossPnls = losses.map((trade) => knownPnl({ trade })!.abs());
  const avgWin = average({ values: winPnls });
  const avgLoss = average({ values: lossPnls });
  const grossProfit = winPnls.reduce((sum, value) => sum.plus(value), new Decimal(0));
  const grossLoss = lossPnls.reduce((sum, value) => sum.plus(value), new Decimal(0));
  const fees = args.trades.reduce((sum, trade) => sum.plus(decimalOrNull({ value: trade.fees }) ?? new Decimal(0)), new Decimal(0));
  const gross = grossProfit.plus(grossLoss);
  const followedKnown = args.trades.filter((trade) => trade.followedPlan !== null);
  const followed = followedKnown.filter((trade) => trade.followedPlan === true);
  const gated = args.trades.filter((trade) => trade.matchStatus === "LINKED");
  const ungated = args.trades.filter((trade) => trade.matchStatus !== "LINKED");
  return {
    closedCount: args.trades.length,
    netPnl: decimalString({ value: netPnl({ trades: args.trades }) }),
    winRate: optionalDecimalString({ value: winRate({ trades: args.trades }) }),
    averageWin: optionalDecimalString({ value: avgWin }),
    averageLoss: optionalDecimalString({ value: avgLoss }),
    payoffRatio: avgWin && avgLoss && !avgLoss.isZero() ? avgWin.dividedBy(avgLoss).toString() : null,
    expectancyR: optionalDecimalString({ value: expectancyR({ trades: args.trades }) }),
    profitFactor: !grossLoss.isZero() ? grossProfit.dividedBy(grossLoss).toString() : null,
    maxDrawdown: decimalString({ value: maxDrawdown({ trades: args.trades }) }),
    averageMae: optionalDecimalString({
      value: average({
        values: args.trades.map((trade) => decimalOrNull({ value: trade.maeUsd })).filter((value): value is Decimal => value !== null),
      }),
    }),
    averageMfe: optionalDecimalString({
      value: average({
        values: args.trades.map((trade) => decimalOrNull({ value: trade.mfeUsd })).filter((value): value is Decimal => value !== null),
      }),
    }),
    ruleAdherenceRate:
      followedKnown.length === 0 ? null : new Decimal(followed.length).dividedBy(followedKnown.length).toString(),
    feesPctOfGross: gross.isZero() ? null : fees.abs().dividedBy(gross).times(100).toString(),
    gated: splitStats({ trades: gated }),
    ungated: splitStats({ trades: ungated }),
  };
}

function buildPsychology(args: { trades: ClosedJournalTrade[] }): PsychologyAnalytics {
  const ordered = [...args.trades].sort((left, right) => left.closedAt.getTime() - right.closedAt.getTime());
  const afterWin: ClosedJournalTrade[] = [];
  const afterLoss: ClosedJournalTrade[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = knownPnl({ trade: ordered[index - 1]! });
    const current = ordered[index]!;
    if (!previous) {
      continue;
    }
    if (previous.greaterThan(0)) {
      afterWin.push(current);
    } else if (previous.lessThan(0)) {
      afterLoss.push(current);
    }
  }
  const scored = args.trades.map((trade) => ({
    trade,
    score: disciplineScore({
      matchStatus: trade.matchStatus,
      followedPlan: trade.followedPlan,
      ruleBreaks: trade.ruleBreaks,
    }),
  }));
  const hours = Array.from({ length: 24 }, (_, hour) =>
    bucketOf({
      key: String(hour).padStart(2, "0"),
      trades: args.trades.filter((trade) => (trade.openedAt ?? trade.closedAt).getUTCHours() === hour),
    }),
  ).filter((bucket) => bucket.count > 0);
  return {
    followed: splitStats({ trades: args.trades.filter((trade) => trade.followedPlan === true) }),
    broken: splitStats({ trades: args.trades.filter((trade) => trade.followedPlan === false) }),
    disciplineAtOrAbove: splitStats({
      trades: scored.filter((item) => disciplineMeetsThreshold({ score: item.score })).map((item) => item.trade),
    }),
    disciplineBelow: splitStats({
      trades: scored.filter((item) => !disciplineMeetsThreshold({ score: item.score })).map((item) => item.trade),
    }),
    afterWin: splitStats({ trades: afterWin }),
    afterLoss: splitStats({ trades: afterLoss }),
    long: splitStats({ trades: args.trades.filter((trade) => trade.direction === "LONG") }),
    short: splitStats({ trades: args.trades.filter((trade) => trade.direction === "SHORT") }),
    trendAligned: splitStats({ trades: args.trades.filter((trade) => trade.alignedWithTrend === true) }),
    countertrend: splitStats({ trades: args.trades.filter((trade) => trade.alignedWithTrend === false) }),
    byHourUtc: hours,
  };
}

export function analyticsFromTrades(args: { trades: ClosedJournalTrade[] }): AnalyticsResult {
  if (args.trades.length === 0) {
    return { empty: true, summary: null, setups: [], instruments: [], psychology: null };
  }
  return {
    empty: false,
    summary: buildSummary({ trades: args.trades }),
    setups: groupBy({ trades: args.trades, keyOf: (trade) => trade.setupKey ?? "unknown" }),
    instruments: groupBy({ trades: args.trades, keyOf: (trade) => trade.symbol ?? "unknown" }),
    psychology: buildPsychology({ trades: args.trades }),
  };
}

export function emptyAnalytics(): AnalyticsResult {
  return analyticsFromTrades({ trades: [] });
}
