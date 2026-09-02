import type {
  AccountType,
  CorrelationBucket,
  EventImpact,
  GateStatus,
  PsychologyChecklist,
  SignalDirection,
  TradingStatus,
} from "@market-sentinel/domain";

export type AccountTotals = {
  availableCash: string;
  invested: string;
  unrealizedPnl: string;
  equity: string;
  cash: string;
};

export type BrokerPosition = {
  etoroPositionId: string;
  instrumentId: number;
  symbol: string | null;
  direction: SignalDirection;
  openedAt: string | null;
  openPrice: string | null;
  units: string | null;
  investedAmount: string | null;
  leverage: string | null;
  stopLoss: string | null;
  takeProfit: string | null;
  unrealizedPnl: string | null;
  fees: string | null;
  mirrorId: number;
};

export type BrokerTrade = {
  etoroPositionId: string;
  instrumentId: number;
  symbol: string | null;
  direction: SignalDirection;
  openedAt: string | null;
  closedAt: string | null;
  openPrice: string | null;
  closePrice: string | null;
  units: string | null;
  investedAmount: string | null;
  leverage: string | null;
  stopLoss: string | null;
  takeProfit: string | null;
  realizedPnl: string | null;
  fees: string | null;
  sourceAccount: AccountType;
};

export type EconomicEvent = {
  id: string;
  eventName: string;
  currency: string;
  impact: EventImpact;
  scheduledAtUtc: Date;
  blackoutBeforeMinutes: number;
  blackoutAfterMinutes: number;
};

export type OpenPlanExposure = {
  symbol: string | null;
  gateStatus: GateStatus;
  riskPct: string | null;
  estimatedPositionSize: string | null;
  signalState?: string | null;
  approvedAt?: string | null;
};

export type RiskPlanInput = {
  symbol: string;
  direction: SignalDirection;
  plannedEntry: string | null;
  stopLoss: string | null;
  target1: string | null;
  riskPct: string | null;
  riskRewardToT1: string | null;
};

export type RiskEvaluation = {
  allowed: boolean;
  blockReasons: string[];
  tradingStatus: TradingStatus;
  maxLossUsd: string | null;
  maxRiskPct: string;
  positionSizeUsd: string | null;
  minTarget: string | null;
  expectedR: string | null;
  dailyPnl: string;
  consecutiveLosses: number;
  cooldownUntil: Date | null;
  newsBlackout: boolean;
};

export type ScoreRiskSnapshot = {
  dailyLossHit: boolean;
  consecutiveLossHit: boolean;
  cooldownActive: boolean;
  newsBlackout: boolean;
};

export type PositionIdentity = {
  etoroPositionId: string;
  openPrice: string | null;
  units: string | null;
  openedAt: string | null;
};

export type ChecklistResult = {
  complete: boolean;
  missing: string[];
};

export type { PsychologyChecklist, CorrelationBucket };
