import type {
  AnalyticsInstrumentsResponse,
  AnalyticsPsychologyResponse,
  AnalyticsSetupsResponse,
  AnalyticsSummaryResponse,
} from "@market-sentinel/contracts";
import { journalEntries, type Database } from "@market-sentinel/db";
import { parseJournalMatchStatus, type SignalDirection } from "@market-sentinel/domain";
import { analyticsFromTrades, emptyAnalytics, type ClosedJournalTrade } from "@market-sentinel/journal";
import { isNotNull } from "drizzle-orm";

function toClosedTrade(args: { row: typeof journalEntries.$inferSelect }): ClosedJournalTrade | null {
  if (!args.row.closedAt) {
    return null;
  }
  const ruleBreaks = Array.isArray(args.row.ruleBreaksJson)
    ? args.row.ruleBreaksJson.filter((item): item is string => typeof item === "string")
    : [];
  return {
    closedAt: args.row.closedAt,
    openedAt: args.row.openedAt,
    symbol: args.row.symbol,
    direction: args.row.direction as SignalDirection,
    setupKey: args.row.setupKey,
    realizedPnl: args.row.realizedPnl,
    fees: args.row.fees,
    resultR: args.row.resultR,
    maeUsd: args.row.maeUsd,
    mfeUsd: args.row.mfeUsd,
    matchStatus: parseJournalMatchStatus({ value: args.row.matchStatus }) ?? "UNGATED",
    followedPlan: args.row.followedPlan,
    ruleBreaks,
    alignedWithTrend: args.row.alignedWithTrend,
  };
}

export async function loadAnalytics(args: { db: Database }) {
  const rows = await args.db.select().from(journalEntries).where(isNotNull(journalEntries.closedAt));
  const trades = rows.map((row) => toClosedTrade({ row })).filter((row): row is ClosedJournalTrade => row !== null);
  return analyticsFromTrades({ trades });
}

export function emptyAnalyticsSummary(): AnalyticsSummaryResponse {
  const empty = emptyAnalytics();
  return { available: false, empty: true, summary: empty.summary };
}

export async function readAnalyticsSummary(args: { db: Database }): Promise<AnalyticsSummaryResponse> {
  const result = await loadAnalytics(args);
  return { available: true, empty: result.empty, summary: result.summary };
}

export async function readAnalyticsSetups(args: { db: Database }): Promise<AnalyticsSetupsResponse> {
  const result = await loadAnalytics(args);
  return { available: true, empty: result.empty, setups: result.setups };
}

export async function readAnalyticsInstruments(args: { db: Database }): Promise<AnalyticsInstrumentsResponse> {
  const result = await loadAnalytics(args);
  return { available: true, empty: result.empty, instruments: result.instruments };
}

export async function readAnalyticsPsychology(args: { db: Database }): Promise<AnalyticsPsychologyResponse> {
  const result = await loadAnalytics(args);
  return { available: true, empty: result.empty, psychology: result.psychology };
}
