import type {
  Location,
  PivotType,
  StructureLabel,
  SwingLabel,
  Timeframe,
  Trend,
  Volatility,
  ZoneSource,
  ZoneStatus,
  ZoneType,
} from "@market-sentinel/domain";

export type StructureBar = {
  instrumentId: string;
  timeframe: Timeframe;
  openTimeUtc: Date;
  high: string;
  low: string;
  open: string;
  close: string;
  isFinal: boolean;
};

export type ConfirmedPivot = {
  instrumentId: string;
  timeframe: Timeframe;
  openTimeUtc: Date;
  type: PivotType;
  price: string;
  leftBars: number;
  rightBars: number;
};

export type ClassifiedSwing = {
  pivot: ConfirmedPivot;
  label: SwingLabel;
};

export type PriceZone = {
  id?: string;
  instrumentId: string;
  timeframe: Timeframe;
  type: ZoneType;
  source: ZoneSource;
  lowerBound: string;
  upperBound: string;
  midpoint: string;
  strengthScore: number;
  touchCount: number;
  lastTouchedAt: Date | null;
  status: ZoneStatus;
  metadataJson: Record<string, unknown>;
};

export type MarketRegime = {
  instrumentId: string;
  timeframe: Timeframe;
  timestamp: Date;
  trend: Trend;
  structure: StructureLabel;
  volatility: Volatility;
  location: Location;
  confidence: number;
  evidenceJson: Record<string, unknown>;
};

export type TimingFlags = {
  rejection: boolean;
  reclaim: boolean;
  failedRetest: boolean;
  engulfingImpulse: boolean;
  rsiReset: boolean;
  bbMeanReclaim: boolean;
  bbMeanLoss: boolean;
};

export type SetupFlags = {
  continuation: boolean;
  reversal: boolean;
  breakout: boolean;
  breakdown: boolean;
  pullback: boolean;
  consolidation: boolean;
  structureTransition: boolean;
};

export type MultiTimeframeContext = {
  context4h: {
    primaryTrend: Trend | null;
    majorSupport: string | null;
    majorResistance: string | null;
    extended: boolean;
    volatility: Volatility | null;
  };
  setup1h: SetupFlags;
  timing15m: TimingFlags;
};
