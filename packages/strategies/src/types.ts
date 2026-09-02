import type {
  OpportunityLabel,
  ProposedSignalState,
  SignalDirection,
  SignalState,
  StreamFreshness,
  StrategyKey,
  Timeframe,
} from "@market-sentinel/domain";
import type { IndicatorValues } from "@market-sentinel/indicators";
import type { MarketRegime, MultiTimeframeContext, PriceZone, StructureBar } from "@market-sentinel/market-structure";

export type StrategyIndicators = Pick<
  IndicatorValues,
  "rsi14" | "atr14" | "ema20" | "ema50" | "bbBasis20" | "bbUpper20x2" | "bbLower20x2" | "trueRange"
> & {
  previousRsi14?: string | null;
};

export type StrategySnapshot = {
  instrumentId: string;
  evaluatedAt: Date;
  lastFinalClose: string;
  lastFinalOpenTimeUtc: Date;
  triggerTimeframe: Timeframe;
  streamFreshness: StreamFreshness;
  multiTimeframe: MultiTimeframeContext;
  regimes: Partial<Record<Timeframe, MarketRegime | null>>;
  zones: PriceZone[];
  indicators: Partial<Record<Timeframe, StrategyIndicators>>;
  lastBars: Partial<Record<Timeframe, StructureBar[]>>;
};

export type StrategyEvaluation = {
  strategyKey: StrategyKey;
  strategyVersion: string;
  direction: SignalDirection;
  proposedState: ProposedSignalState;
  labels: string[];
  triggerTimeframe: Timeframe;
  entryZoneLow: string | null;
  entryZoneHigh: string | null;
  invalidationPrice: string | null;
  target1: string | null;
  target2: string | null;
  target3: string | null;
  riskRewardToT1: string | null;
  riskRewardToT2: string | null;
  evidence: Record<string, unknown>;
  parameterSnapshot: Record<string, string>;
};

export type Strategy = {
  key: StrategyKey;
  version: string;
  evaluate(args: { snapshot: StrategySnapshot }): StrategyEvaluation;
};

export type ScoreFactors = {
  alignment4h: number;
  setup1h: number;
  confluenceSr: number;
  confirmation15m: number;
  momentumVol: number;
  rewardRisk: number;
  eventRisk: number;
};

export type OpportunityScore = {
  raw: number;
  display: number;
  label: OpportunityLabel;
  blockedReason: string | null;
  factors: ScoreFactors;
  evidence: Record<string, unknown>;
};

export type SignalRecord = {
  id: string;
  instrumentId: string;
  symbol: string;
  strategyKey: StrategyKey;
  strategyVersion: string;
  direction: SignalDirection;
  state: SignalState;
  triggerTimeframe: Timeframe;
  detectedAt: Date;
  watchingAt: Date | null;
  confirmedAt: Date | null;
  tradePlannedAt: Date | null;
  enteredAt: Date | null;
  closedAt: Date | null;
  invalidatedAt: Date | null;
  expiredAt: Date | null;
  dismissedAt: Date | null;
  score: number;
  confidenceLabel: OpportunityLabel;
  entryZoneLow: string | null;
  entryZoneHigh: string | null;
  invalidationPrice: string | null;
  target1: string | null;
  target2: string | null;
  target3: string | null;
  riskRewardToT1: string | null;
  riskRewardToT2: string | null;
  lastEvaluatedOpenTimeUtc: Date;
  evidenceJson: Record<string, unknown>;
  snapshotJson: Record<string, unknown>;
};

export type TransitionEvent = "SIGNAL_DETECTED" | "SIGNAL_STATE_CHANGED" | null;

export type TransitionResult = {
  next: SignalRecord | null;
  changed: boolean;
  event: TransitionEvent;
};
