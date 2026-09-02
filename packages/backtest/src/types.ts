import type { SignalDirection, StrategyKey, Timeframe } from "@market-sentinel/domain";
import type { SignalRecord, StrategySnapshot } from "@market-sentinel/strategies";
import type { MarketRegime, PriceZone } from "@market-sentinel/market-structure";
import type { IndicatorValues } from "@market-sentinel/indicators";

export type InputCandle = {
  instrumentId: string;
  symbol: string;
  timeframe: Timeframe;
  openTimeUtc: Date;
  closeTimeUtc: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  isFinal: boolean;
};

export type BacktestCosts = {
  slippage: string;
  spread: string;
  feeBps: string;
  units: string;
};

export type SimulatedTrade = {
  id: string;
  signalId: string;
  strategyKey: StrategyKey;
  strategyVersion: string;
  direction: SignalDirection;
  status: "filled" | "closed" | "open" | "unfillable";
  unfillableReason: "gap" | null;
  openedAt: Date | null;
  closedAt: Date | null;
  entryPrice: string | null;
  exitPrice: string | null;
  realizedPnl: string | null;
  fees: string | null;
  resultR: string | null;
  maeUsd: string | null;
  mfeUsd: string | null;
  exitReason: string | null;
  stopLoss: string | null;
  target1: string | null;
  entryBarIndex: number | null;
  exitBarIndex: number | null;
};

export type BacktestMetrics = {
  empty: boolean;
  tradeCount: number;
  setupCount: number;
  winRate: string | null;
  expectancyR: string | null;
  profitFactor: string | null;
  maxDrawdown: string | null;
  averageR: string | null;
  averageMae: string | null;
  averageMfe: string | null;
  netPnl: string | null;
  timeInMarketBars: number;
  consecutiveWins: number;
  consecutiveLosses: number;
};

export type WalkForwardWindow = {
  kind: "in-sample" | "out-of-sample";
  from: Date;
  to: Date;
  metrics: BacktestMetrics;
  trades: SimulatedTrade[];
};

export type ReplayFrame = {
  index: number;
  barIndex: number;
  openTimeUtc: Date;
  closeTimeUtc: Date;
  lastFinalClose: string;
  signals: SignalRecord[];
  zones: PriceZone[];
  regimes: Partial<Record<Timeframe, MarketRegime | null>>;
  indicators: Partial<Record<Timeframe, IndicatorValues>>;
};

export type EventLoopResult = {
  frames: ReplayFrame[];
  signals: SignalRecord[];
  snapshots: StrategySnapshot[];
  emptyReason: "insufficient-history" | "no-final-candles" | null;
  warmupBars: number;
};

export type SequenceStep = {
  openTimeUtc: Date;
  states: Array<{ strategyKey: StrategyKey; direction: SignalDirection; state: string }>;
};
