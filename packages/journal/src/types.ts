import type { JournalMatchStatus, SignalDirection } from "@market-sentinel/domain";

export type MatchCandidate = {
  planId: string;
  symbol: string;
  direction: SignalDirection;
  approvedAt: Date;
};

export type MatchDecision = {
  status: JournalMatchStatus;
  planId: string | null;
  candidateIds: string[];
};

export type ExcursionState = {
  maeUsd: string | null;
  maeR: string | null;
  mfeUsd: string | null;
  mfeR: string | null;
};

export type ClosedJournalTrade = {
  closedAt: Date;
  openedAt: Date | null;
  symbol: string | null;
  direction: SignalDirection;
  setupKey: string | null;
  realizedPnl: string | null;
  fees: string | null;
  resultR: string | null;
  maeUsd: string | null;
  mfeUsd: string | null;
  matchStatus: JournalMatchStatus;
  followedPlan: boolean | null;
  ruleBreaks: string[];
  alignedWithTrend: boolean | null;
};

export type MetricBucket = {
  key: string;
  count: number;
  netPnl: string | null;
  winRate: string | null;
  expectancyR: string | null;
};

export type AnalyticsSummary = {
  closedCount: number;
  netPnl: string;
  winRate: string | null;
  averageWin: string | null;
  averageLoss: string | null;
  payoffRatio: string | null;
  expectancyR: string | null;
  profitFactor: string | null;
  maxDrawdown: string;
  averageMae: string | null;
  averageMfe: string | null;
  ruleAdherenceRate: string | null;
  feesPctOfGross: string | null;
  gated: { count: number; netPnl: string; expectancyR: string | null; winRate: string | null };
  ungated: { count: number; netPnl: string; expectancyR: string | null; winRate: string | null };
};

export type PsychologyAnalytics = {
  followed: { count: number; netPnl: string; expectancyR: string | null };
  broken: { count: number; netPnl: string; expectancyR: string | null };
  disciplineAtOrAbove: { count: number; netPnl: string; expectancyR: string | null };
  disciplineBelow: { count: number; netPnl: string; expectancyR: string | null };
  afterWin: { count: number; netPnl: string; expectancyR: string | null };
  afterLoss: { count: number; netPnl: string; expectancyR: string | null };
  long: { count: number; netPnl: string; expectancyR: string | null };
  short: { count: number; netPnl: string; expectancyR: string | null };
  trendAligned: { count: number; netPnl: string; expectancyR: string | null };
  countertrend: { count: number; netPnl: string; expectancyR: string | null };
  byHourUtc: MetricBucket[];
};

export type AnalyticsResult = {
  empty: boolean;
  summary: AnalyticsSummary | null;
  setups: MetricBucket[];
  instruments: MetricBucket[];
  psychology: PsychologyAnalytics | null;
};
