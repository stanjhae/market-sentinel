import {
  SIGNAL_ZONE_LIBRARY,
  breakdownRetestReplay,
  doNotChaseReplay,
  falseBreakdownReplay,
  sweepReclaimReplay,
  trendPullbackReplay,
  type SignalReplayStep,
} from "@market-sentinel/test-fixtures";
import { describe, expect, it } from "vitest";
import { applySignalTransition, canTransition, createPlanStub, dismissSignal } from "./machine.js";
import { breakdownRetestStrategy } from "./breakdown-retest.js";
import { doNotChaseStrategy } from "./do-not-chase.js";
import { evaluateAllStrategies } from "./evaluate.js";
import { bestOpenTradeSetup, emptyEvaluation, nextTarget, pickPreferredEvaluation } from "./helpers.js";
import { scoreOpportunity } from "./score.js";
import { sweepReclaimStrategy } from "./sweep-reclaim.js";
import { trendPullbackStrategy } from "./trend-pullback.js";
import type { Strategy, StrategyEvaluation, StrategySnapshot } from "./types.js";

function zone(args: { id: string; type: "SUPPORT" | "RESISTANCE"; lowerBound: string; upperBound: string; midpoint: string; status?: "ACTIVE" | "BROKEN" }): StrategySnapshot["zones"][number] {
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

function snapshotFromStep(args: { step: SignalReplayStep; index: number; priorBars?: StrategySnapshot["lastBars"]["15m"] }): StrategySnapshot {
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

function replay(args: { steps: SignalReplayStep[]; strategy: Strategy }) {
  const prior: NonNullable<StrategySnapshot["lastBars"]["15m"]> = [];
  return args.steps.map((step, index) => {
    const snapshot = snapshotFromStep({ step, index, priorBars: prior });
    const bar = snapshot.lastBars["15m"]?.[snapshot.lastBars["15m"].length - 1];
    if (bar) {
      prior.push(bar);
    }
    return args.strategy.evaluate({ snapshot }).proposedState;
  });
}

describe("breakdown-retest", () => {
  it("walks DETECTED → WATCHING → CONFIRMED on the breakdown+retest fixture", () => {
    expect(replay({ steps: breakdownRetestReplay(), strategy: breakdownRetestStrategy })).toEqual([
      "DETECTED",
      "WATCHING",
      "CONFIRMED",
    ]);
  });

  it("invalidates a false breakdown", () => {
    expect(replay({ steps: falseBreakdownReplay(), strategy: breakdownRetestStrategy })).toEqual(["DETECTED", "INVALIDATED"]);
  });
});

describe("sweep-reclaim", () => {
  it("walks DETECTED → WATCHING → CONFIRMED and labels COUNTERTREND", () => {
    const steps = sweepReclaimReplay();
    expect(replay({ steps, strategy: sweepReclaimStrategy })).toEqual(["DETECTED", "WATCHING", "CONFIRMED"]);
    const prior = steps.slice(0, 2).map((step, index) => {
      const snap = snapshotFromStep({ step, index });
      return snap.lastBars["15m"]?.[0];
    }).filter((bar): bar is NonNullable<typeof bar> => Boolean(bar));
    const confirmed = sweepReclaimStrategy.evaluate({
      snapshot: snapshotFromStep({ step: steps[2]!, index: 2, priorBars: prior }),
    });
    expect(confirmed.labels).toContain("COUNTERTREND");
  });
});

describe("trend-pullback", () => {
  it("walks DETECTED → WATCHING → CONFIRMED", () => {
    expect(replay({ steps: trendPullbackReplay(), strategy: trendPullbackStrategy })).toEqual(["DETECTED", "WATCHING", "CONFIRMED"]);
  });
});

describe("do-not-chase", () => {
  it("emits an advisory then clears", () => {
    expect(replay({ steps: doNotChaseReplay(), strategy: doNotChaseStrategy })).toEqual(["DETECTED", "INVALIDATED"]);
  });

  it("suppresses trend-pullback while active unless a reset occurs", () => {
    const chase = snapshotFromStep({ step: doNotChaseReplay()[0]!, index: 0 });
    const evaluations = evaluateAllStrategies({ snapshot: chase });
    expect(evaluations.find((item) => item.strategyKey === "do-not-chase")?.labels).toContain("DO_NOT_CHASE");
    expect(evaluations.find((item) => item.strategyKey === "trend-pullback")?.proposedState).toBe("NONE");
    const reset = snapshotFromStep({
      step: { ...doNotChaseReplay()[0]!, timing: { rsiReset: true }, setup: { continuation: true, pullback: true }, ema20: "121" },
      index: 0,
    });
    const withReset = evaluateAllStrategies({ snapshot: reset });
    expect(withReset.find((item) => item.strategyKey === "trend-pullback")?.proposedState).not.toBe("NONE");
  });
});

describe("state machine", () => {
  it("never jumps DETECTED to ENTERED and is idempotent on the same candle", () => {
    expect(canTransition({ from: "DETECTED", to: "ENTERED" })).toBe(false);
    expect(canTransition({ from: "DETECTED", to: "WATCHING" })).toBe(true);
    const snapshot = snapshotFromStep({ step: breakdownRetestReplay()[0]!, index: 0 });
    const evaluation = breakdownRetestStrategy.evaluate({ snapshot });
    const first = applySignalTransition({
      current: null,
      evaluation,
      snapshot,
      now: snapshot.evaluatedAt,
      barsElapsed15m: 0,
      idFactory: () => "sig-1",
      symbol: "US30",
    });
    expect(first.next?.state).toBe("DETECTED");
    const again = applySignalTransition({
      current: first.next,
      evaluation,
      snapshot,
      now: snapshot.evaluatedAt,
      barsElapsed15m: 0,
      idFactory: () => "sig-2",
      symbol: "US30",
    });
    expect(again.changed).toBe(false);
    expect(again.next?.id).toBe("sig-1");
  });

  it("advances one legal step per candle", () => {
    const steps = breakdownRetestReplay();
    let current = applySignalTransition({
      current: null,
      evaluation: breakdownRetestStrategy.evaluate({ snapshot: snapshotFromStep({ step: steps[0]!, index: 0 }) }),
      snapshot: snapshotFromStep({ step: steps[0]!, index: 0 }),
      now: new Date("2026-09-01T12:00:00.000Z"),
      barsElapsed15m: 0,
      idFactory: () => "sig-1",
      symbol: "US30",
    }).next;
    current = applySignalTransition({
      current,
      evaluation: breakdownRetestStrategy.evaluate({ snapshot: snapshotFromStep({ step: steps[1]!, index: 1 }) }),
      snapshot: snapshotFromStep({ step: steps[1]!, index: 1 }),
      now: new Date("2026-09-01T12:15:00.000Z"),
      barsElapsed15m: 1,
      idFactory: () => "sig-1",
      symbol: "US30",
    }).next;
    expect(current?.state).toBe("WATCHING");
    current = applySignalTransition({
      current,
      evaluation: breakdownRetestStrategy.evaluate({ snapshot: snapshotFromStep({ step: steps[2]!, index: 2 }) }),
      snapshot: snapshotFromStep({ step: steps[2]!, index: 2 }),
      now: new Date("2026-09-01T12:30:00.000Z"),
      barsElapsed15m: 2,
      idFactory: () => "sig-1",
      symbol: "US30",
    }).next;
    expect(current?.state).toBe("CONFIRMED");
  });

  it("freezes while the stream is stale", () => {
    const snapshot = { ...snapshotFromStep({ step: breakdownRetestReplay()[0]!, index: 0 }), streamFreshness: "STALE" as const };
    const result = applySignalTransition({
      current: null,
      evaluation: breakdownRetestStrategy.evaluate({ snapshot }),
      snapshot,
      now: snapshot.evaluatedAt,
      barsElapsed15m: 0,
      idFactory: () => "sig-1",
      symbol: "US30",
    });
    expect(result.next).toBeNull();
    expect(result.changed).toBe(false);
  });
});

describe("opportunity score", () => {
  it("is decomposable and keeps score separate from entry status", () => {
    const snapshot = snapshotFromStep({ step: breakdownRetestReplay()[2]!, index: 2 });
    const evaluation = breakdownRetestStrategy.evaluate({ snapshot });
    const score = scoreOpportunity({ snapshot, evaluation });
    expect(score.raw).toBe(
      score.factors.alignment4h +
        score.factors.setup1h +
        score.factors.confluenceSr +
        score.factors.confirmation15m +
        score.factors.momentumVol +
        score.factors.rewardRisk +
        score.factors.eventRisk,
    );
    expect(score.evidence.stubUntil).toBe("M6");
    expect(evaluation.proposedState).toBe("CONFIRMED");
    expect(score.display).toBeGreaterThan(0);
  });

  it("does not treat empty zones as insufficient data for do-not-chase", () => {
    const snapshot = { ...snapshotFromStep({ step: doNotChaseReplay()[0]!, index: 0 }), zones: [] };
    const evaluation = doNotChaseStrategy.evaluate({ snapshot });
    const score = scoreOpportunity({ snapshot, evaluation });
    expect(evaluation.proposedState).toBe("DETECTED");
    expect(score.blockedReason).not.toBe("insufficient-data");
    expect(score.display).toBeGreaterThan(0);
  });

  it("forces display score 0 on a stale stream without dropping the breakdown", () => {
    const snapshot = { ...snapshotFromStep({ step: breakdownRetestReplay()[2]!, index: 2 }), streamFreshness: "STALE" as const };
    const evaluation = breakdownRetestStrategy.evaluate({ snapshot });
    const score = scoreOpportunity({ snapshot, evaluation });
    expect(score.display).toBe(0);
    expect(score.blockedReason).toBe("stale-stream");
    expect(score.raw).toBeGreaterThan(0);
  });
});

describe("targets and identity", () => {
  it("refuses a nextTarget on the wrong side of price", () => {
    const support = zone({ id: "support", type: "SUPPORT", lowerBound: "100", upperBound: "102", midpoint: "101" });
    expect(
      nextTarget({
        close: "98",
        direction: "SHORT",
        zones: [support],
        atr: "2",
      }),
    ).toBeNull();
    expect(
      nextTarget({
        close: "98",
        direction: "LONG",
        zones: [support],
        atr: "2",
      }),
    ).toBeNull();
  });

  it("picks the stronger directional evaluation instead of SHORT-first", () => {
    const weakShort: StrategyEvaluation = {
      ...emptyEvaluation({
        strategyKey: "breakdown-retest",
        snapshot: snapshotFromStep({ step: breakdownRetestReplay()[0]!, index: 0 }),
        direction: "SHORT",
      }),
      proposedState: "DETECTED",
      riskRewardToT1: "1.2",
    };
    const strongLong: StrategyEvaluation = {
      ...weakShort,
      direction: "LONG",
      proposedState: "CONFIRMED",
      riskRewardToT1: "2.4",
    };
    expect(pickPreferredEvaluation({ left: strongLong, right: weakShort })?.direction).toBe("LONG");
  });

  it("emits both LONG and SHORT so the unused side can clear", () => {
    const snapshot = snapshotFromStep({ step: breakdownRetestReplay()[0]!, index: 0 });
    const keys = evaluateAllStrategies({ snapshot }).map((item) => `${item.strategyKey}:${item.direction}`);
    expect(keys).toContain("breakdown-retest:LONG");
    expect(keys).toContain("breakdown-retest:SHORT");
    expect(keys).toContain("do-not-chase:NEUTRAL");
  });

  it("excludes do-not-chase from the dashboard best setup", () => {
    const chase = {
      strategyKey: "do-not-chase",
      score: 90,
      state: "DETECTED",
    };
    const trade = {
      strategyKey: "breakdown-retest",
      score: 70,
      state: "WATCHING",
    };
    expect(bestOpenTradeSetup({ records: [chase, trade] })?.strategyKey).toBe("breakdown-retest");
    expect(bestOpenTradeSetup({ records: [chase] })).toBeNull();
  });
});

describe("sweep-reclaim edges", () => {
  it("invalidates against the original sweep extreme, not the last bar", () => {
    const sweep = sweepReclaimReplay()[0]!;
    const later = {
      ...sweep,
      lastClose: "99.8",
      lastHigh: "101.2",
      lastLow: "100.1",
      rsi14: "30",
      previousRsi14: "28",
      timing: { reclaim: true },
    };
    const prior = [snapshotFromStep({ step: sweep, index: 0 }).lastBars["15m"]![0]!];
    const evaluation = sweepReclaimStrategy.evaluate({
      snapshot: snapshotFromStep({ step: later, index: 1, priorBars: prior }),
    });
    expect(evaluation.proposedState).not.toBe("INVALIDATED");
    const lost = {
      ...later,
      lastClose: "99.0",
      lastLow: "98.9",
    };
    expect(
      sweepReclaimStrategy.evaluate({
        snapshot: snapshotFromStep({ step: lost, index: 1, priorBars: prior }),
      }).proposedState,
    ).toBe("INVALIDATED");
  });

  it("stays WATCHING when reclaim quality is there but R:R is below 2", () => {
    const steps = sweepReclaimReplay();
    const prior = steps.slice(0, 2).map((step, index) => snapshotFromStep({ step, index }).lastBars["15m"]![0]!);
    const snapshot = snapshotFromStep({ step: steps[2]!, index: 2, priorBars: prior });
    snapshot.zones = snapshot.zones.filter((item) => item.type !== "RESISTANCE");
    const evaluation = sweepReclaimStrategy.evaluate({ snapshot });
    expect(evaluation.proposedState).toBe("WATCHING");
    expect(evaluation.riskRewardToT1).toBeNull();
  });
});

describe("state machine release", () => {
  function walkBreakdown(args: { through: number }) {
    const steps = breakdownRetestReplay();
    let current = applySignalTransition({
      current: null,
      evaluation: breakdownRetestStrategy.evaluate({ snapshot: snapshotFromStep({ step: steps[0]!, index: 0 }) }),
      snapshot: snapshotFromStep({ step: steps[0]!, index: 0 }),
      now: new Date("2026-09-01T12:00:00.000Z"),
      barsElapsed15m: 0,
      idFactory: () => "sig-1",
      symbol: "US30",
    }).next;
    for (let index = 1; index <= args.through; index += 1) {
      current = applySignalTransition({
        current,
        evaluation: breakdownRetestStrategy.evaluate({ snapshot: snapshotFromStep({ step: steps[index]!, index }) }),
        snapshot: snapshotFromStep({ step: steps[index]!, index }),
        now: new Date(Date.UTC(2026, 8, 1, 12, index * 15)),
        barsElapsed15m: index,
        idFactory: () => "sig-1",
        symbol: "US30",
      }).next;
    }
    return current;
  }

  it("expires DETECTED after 48 idle 15m bars", () => {
    const current = walkBreakdown({ through: 0 });
    const later = snapshotFromStep({ step: { ...breakdownRetestReplay()[0]!, lastClose: "110", setup: {}, timing: {} }, index: 48 });
    const result = applySignalTransition({
      current,
      evaluation: emptyEvaluation({ strategyKey: "breakdown-retest", snapshot: later, direction: "SHORT" }),
      snapshot: later,
      now: later.evaluatedAt,
      barsElapsed15m: 48,
      idFactory: () => "sig-2",
      symbol: "US30",
    });
    expect(result.next?.state).toBe("EXPIRED");
  });

  it("invalidates CONFIRMED and TRADE_PLANNED when the setup disappears", () => {
    const confirmed = walkBreakdown({ through: 2 });
    expect(confirmed?.state).toBe("CONFIRMED");
    const later = snapshotFromStep({ step: { ...breakdownRetestReplay()[0]!, lastClose: "110", setup: {}, timing: {} }, index: 4 });
    const cleared = applySignalTransition({
      current: confirmed,
      evaluation: emptyEvaluation({ strategyKey: "breakdown-retest", snapshot: later, direction: "SHORT" }),
      snapshot: later,
      now: later.evaluatedAt,
      barsElapsed15m: 2,
      idFactory: () => "sig-2",
      symbol: "US30",
    });
    expect(cleared.next?.state).toBe("INVALIDATED");
    const planned = createPlanStub({ current: confirmed!, now: new Date("2026-09-01T13:00:00.000Z") });
    expect(planned.next?.state).toBe("TRADE_PLANNED");
    const plannedGone = applySignalTransition({
      current: planned.next,
      evaluation: emptyEvaluation({ strategyKey: "breakdown-retest", snapshot: later, direction: "SHORT" }),
      snapshot: later,
      now: later.evaluatedAt,
      barsElapsed15m: 2,
      idFactory: () => "sig-3",
      symbol: "US30",
    });
    expect(plannedGone.next?.state).toBe("INVALIDATED");
  });

  it("dismisses an open signal and refuses a second dismiss", () => {
    const current = walkBreakdown({ through: 1 });
    const first = dismissSignal({ current: current!, now: new Date("2026-09-01T13:00:00.000Z") });
    expect(first.changed).toBe(true);
    expect(first.next?.state).toBe("DISMISSED");
    const second = dismissSignal({ current: first.next!, now: new Date("2026-09-01T13:01:00.000Z") });
    expect(second.changed).toBe(false);
  });
});
