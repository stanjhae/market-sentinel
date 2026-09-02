import {
  SIGNAL_ZONE_LIBRARY,
  type SignalReplayStep,
} from "@market-sentinel/test-fixtures";
import type { StrategySnapshot } from "@market-sentinel/strategies";

function zone(args: {
  id: string;
  type: "SUPPORT" | "RESISTANCE";
  lowerBound: string;
  upperBound: string;
  midpoint: string;
  status?: "ACTIVE" | "BROKEN";
}): StrategySnapshot["zones"][number] {
  return {
    id: args.id,
    instrumentId: "inst-1",
    timeframe: "1h",
    type: args.type,
    source: "AUTO_PIVOT",
    lowerBound: args.lowerBound,
    upperBound: args.upperBound,
    midpoint: args.midpoint,
    strengthScore: 70,
    touchCount: 3,
    lastTouchedAt: null,
    status: args.status ?? "ACTIVE",
    metadataJson: {},
  };
}

export function snapshotFromReplayStep(args: {
  step: SignalReplayStep;
  index: number;
  priorBars?: NonNullable<StrategySnapshot["lastBars"]["15m"]>;
}): StrategySnapshot {
  const open = new Date(Date.UTC(2026, 8, 1, 12, args.index * 15));
  const bar = {
    instrumentId: "inst-1",
    timeframe: "15m" as const,
    openTimeUtc: open,
    open: args.step.lastOpen ?? args.step.lastLow,
    high: args.step.lastHigh,
    low: args.step.lastLow,
    close: args.step.lastClose,
    isFinal: true,
  };
  const history = [...(args.priorBars ?? []), bar];
  return {
    instrumentId: "inst-1",
    evaluatedAt: open,
    lastFinalClose: args.step.lastClose,
    lastFinalOpenTimeUtc: open,
    triggerTimeframe: "15m",
    streamFreshness: "LIVE",
    multiTimeframe: {
      context4h: {
        primaryTrend: args.step.trend4h ?? null,
        majorSupport: SIGNAL_ZONE_LIBRARY.support.midpoint,
        majorResistance: SIGNAL_ZONE_LIBRARY.resistance.midpoint,
        extended: args.step.location15m === "EXTENDED_UP" || args.step.location15m === "EXTENDED_DOWN",
        volatility: "NORMAL",
      },
      setup1h: {
        continuation: false,
        reversal: false,
        breakout: false,
        breakdown: false,
        pullback: false,
        consolidation: false,
        structureTransition: false,
        ...args.step.setup,
      },
      timing15m: {
        rejection: false,
        reclaim: false,
        failedRetest: false,
        engulfingImpulse: false,
        rsiReset: false,
        bbMeanReclaim: false,
        bbMeanLoss: false,
        ...args.step.timing,
      },
    },
    regimes: {
      "1h": args.step.structure1h
        ? {
            instrumentId: "inst-1",
            timeframe: "1h",
            timestamp: open,
            trend: args.step.trend4h ?? "RANGE",
            structure: args.step.structure1h,
            volatility: "NORMAL",
            location: args.step.location15m ?? "MID_RANGE",
            confidence: 70,
            evidenceJson: {},
          }
        : null,
      "15m": {
        instrumentId: "inst-1",
        timeframe: "15m",
        timestamp: open,
        trend: args.step.trend4h ?? "RANGE",
        structure: args.step.structure1h ?? "MIXED",
        volatility: "NORMAL",
        location: args.step.location15m ?? "MID_RANGE",
        confidence: 60,
        evidenceJson: {},
      },
    },
    zones: [
      zone({ id: "support", type: "SUPPORT", ...SIGNAL_ZONE_LIBRARY.support }),
      zone({ id: "next-support", type: "SUPPORT", ...SIGNAL_ZONE_LIBRARY.nextSupport }),
      zone({ id: "resistance", type: "RESISTANCE", ...SIGNAL_ZONE_LIBRARY.resistance }),
    ],
    indicators: {
      "15m": {
        rsi14: args.step.rsi14,
        previousRsi14: args.step.previousRsi14 ?? null,
        atr14: args.step.atr14,
        ema20: args.step.ema20 ?? "101",
        ema50: "100",
        bbBasis20: "105",
        bbUpper20x2: args.step.bbUpper20x2 ?? "119",
        bbLower20x2: args.step.bbLower20x2 ?? "90",
        trueRange: args.step.trueRange ?? "1",
      },
    },
    lastBars: {
      "15m": history.slice(-8),
      "1h": [bar],
    },
  };
}

export function snapshotsFromReplay(args: { steps: SignalReplayStep[] }): StrategySnapshot[] {
  const prior: NonNullable<StrategySnapshot["lastBars"]["15m"]> = [];
  return args.steps.map((step, index) => {
    const snapshot = snapshotFromReplayStep({ step, index, priorBars: prior });
    const bar = snapshot.lastBars["15m"]?.[snapshot.lastBars["15m"].length - 1];
    if (bar) {
      prior.push(bar);
    }
    return snapshot;
  });
}
