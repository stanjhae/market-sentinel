import { isTerminalSignalState, type SignalState, type StreamFreshness } from "@market-sentinel/domain";
import { STRATEGY_DEFAULTS } from "./defaults.js";
import { scoreOpportunity } from "./score.js";
import type { SignalRecord, StrategyEvaluation, StrategySnapshot, TransitionResult } from "./types.js";

const FORWARD: Record<SignalState, SignalState[]> = {
  DETECTED: ["WATCHING", "INVALIDATED", "EXPIRED", "DISMISSED"],
  WATCHING: ["CONFIRMED", "INVALIDATED", "EXPIRED", "DISMISSED"],
  CONFIRMED: ["TRADE_PLANNED", "INVALIDATED", "EXPIRED", "DISMISSED"],
  TRADE_PLANNED: ["ENTERED", "INVALIDATED", "EXPIRED", "DISMISSED"],
  ENTERED: ["CLOSED", "INVALIDATED"],
  CLOSED: [],
  INVALIDATED: [],
  EXPIRED: [],
  DISMISSED: [],
};

export function canTransition(args: { from: SignalState; to: SignalState }): boolean {
  return FORWARD[args.from].includes(args.to);
}

export function streamEvaluationFrozen(args: { freshness: StreamFreshness }): boolean {
  return args.freshness === "STALE" || args.freshness === "DISCONNECTED";
}

function stepToward(args: { from: SignalState; proposed: SignalState }): SignalState | null {
  if (args.from === args.proposed) {
    return null;
  }
  if (canTransition({ from: args.from, to: args.proposed })) {
    return args.proposed;
  }
  if (args.proposed === "CONFIRMED" && args.from === "DETECTED") {
    return "WATCHING";
  }
  return null;
}

function applyTimestamps(args: { record: SignalRecord; state: SignalState; now: Date }): SignalRecord {
  const next = { ...args.record, state: args.state, updatedAt: args.now } as SignalRecord;
  if (args.state === "WATCHING") {
    next.watchingAt = args.now;
  }
  if (args.state === "CONFIRMED") {
    next.confirmedAt = args.now;
  }
  if (args.state === "TRADE_PLANNED") {
    next.tradePlannedAt = args.now;
  }
  if (args.state === "INVALIDATED") {
    next.invalidatedAt = args.now;
  }
  if (args.state === "EXPIRED") {
    next.expiredAt = args.now;
  }
  if (args.state === "DISMISSED") {
    next.dismissedAt = args.now;
  }
  return next;
}

function appendTransition(args: { record: SignalRecord; state: SignalState; at: Date; evidence: Record<string, unknown> }): Record<string, unknown> {
  const previous = Array.isArray(args.record.evidenceJson.transitions) ? args.record.evidenceJson.transitions : [];
  return {
    ...args.record.evidenceJson,
    ...args.evidence,
    transitions: [...previous, { state: args.state, at: args.at.toISOString() }],
  };
}

export function createDetectedSignal(args: {
  id: string;
  symbol: string;
  snapshot: StrategySnapshot;
  evaluation: StrategyEvaluation;
  score: ReturnType<typeof scoreOpportunity>;
  now: Date;
}): SignalRecord {
  return {
    id: args.id,
    instrumentId: args.snapshot.instrumentId,
    symbol: args.symbol,
    strategyKey: args.evaluation.strategyKey,
    strategyVersion: args.evaluation.strategyVersion,
    direction: args.evaluation.direction,
    state: "DETECTED",
    triggerTimeframe: args.evaluation.triggerTimeframe,
    detectedAt: args.now,
    watchingAt: null,
    confirmedAt: null,
    tradePlannedAt: null,
    invalidatedAt: null,
    expiredAt: null,
    dismissedAt: null,
    score: args.score.display,
    confidenceLabel: args.score.label,
    entryZoneLow: args.evaluation.entryZoneLow,
    entryZoneHigh: args.evaluation.entryZoneHigh,
    invalidationPrice: args.evaluation.invalidationPrice,
    target1: args.evaluation.target1,
    target2: args.evaluation.target2,
    target3: args.evaluation.target3,
    riskRewardToT1: args.evaluation.riskRewardToT1,
    riskRewardToT2: args.evaluation.riskRewardToT2,
    lastEvaluatedOpenTimeUtc: args.snapshot.lastFinalOpenTimeUtc,
    evidenceJson: {
      ...args.evaluation.evidence,
      score: args.score,
      transitions: [{ state: "DETECTED", at: args.now.toISOString() }],
    },
    snapshotJson: {
      parameters: args.evaluation.parameterSnapshot,
      lastFinalClose: args.snapshot.lastFinalClose,
      lastFinalOpenTimeUtc: args.snapshot.lastFinalOpenTimeUtc.toISOString(),
      multiTimeframe: args.snapshot.multiTimeframe,
    },
  };
}

export function applySignalTransition(args: {
  current: SignalRecord | null;
  evaluation: StrategyEvaluation;
  snapshot: StrategySnapshot;
  now: Date;
  barsElapsed15m: number;
  idFactory: () => string;
  symbol: string;
}): TransitionResult {
  if (streamEvaluationFrozen({ freshness: args.snapshot.streamFreshness })) {
    return { next: args.current, changed: false, event: null };
  }
  if (args.current && args.current.lastEvaluatedOpenTimeUtc.getTime() === args.snapshot.lastFinalOpenTimeUtc.getTime()) {
    return { next: args.current, changed: false, event: null };
  }
  const score = scoreOpportunity({ snapshot: args.snapshot, evaluation: args.evaluation });
  if (!args.current) {
    if (args.evaluation.proposedState === "NONE" || args.evaluation.proposedState === "INVALIDATED" || args.evaluation.proposedState === "EXPIRED") {
      return { next: null, changed: false, event: null };
    }
    return {
      next: createDetectedSignal({
        id: args.idFactory(),
        symbol: args.symbol,
        snapshot: args.snapshot,
        evaluation: args.evaluation,
        score,
        now: args.now,
      }),
      changed: true,
      event: "SIGNAL_DETECTED",
    };
  }
  if (isTerminalSignalState({ state: args.current.state })) {
    return { next: args.current, changed: false, event: null };
  }
  let target: SignalState | null = null;
  if (args.evaluation.proposedState === "INVALIDATED") {
    target = "INVALIDATED";
  } else if (args.evaluation.proposedState === "NONE" && (args.current.state === "CONFIRMED" || args.current.state === "TRADE_PLANNED")) {
    target = "INVALIDATED";
  } else if (
    (args.current.state === "DETECTED" || args.current.state === "WATCHING") &&
    args.barsElapsed15m >= STRATEGY_DEFAULTS.expiryBars15m &&
    (args.evaluation.proposedState === "NONE" || args.evaluation.proposedState === args.current.state || args.evaluation.proposedState === "EXPIRED")
  ) {
    target = "EXPIRED";
  } else if (args.evaluation.proposedState === "EXPIRED") {
    target = "EXPIRED";
  } else if (args.evaluation.proposedState === "NONE") {
    target = null;
  } else {
    target = stepToward({ from: args.current.state, proposed: args.evaluation.proposedState });
  }
  const patched: SignalRecord = {
    ...args.current,
    score: score.display,
    confidenceLabel: score.label,
    entryZoneLow: args.evaluation.entryZoneLow ?? args.current.entryZoneLow,
    entryZoneHigh: args.evaluation.entryZoneHigh ?? args.current.entryZoneHigh,
    invalidationPrice: args.evaluation.invalidationPrice ?? args.current.invalidationPrice,
    target1: args.evaluation.target1 ?? args.current.target1,
    target2: args.evaluation.target2 ?? args.current.target2,
    target3: args.evaluation.target3 ?? args.current.target3,
    riskRewardToT1: args.evaluation.riskRewardToT1 ?? args.current.riskRewardToT1,
    riskRewardToT2: args.evaluation.riskRewardToT2 ?? args.current.riskRewardToT2,
    lastEvaluatedOpenTimeUtc: args.snapshot.lastFinalOpenTimeUtc,
    snapshotJson: {
      ...args.current.snapshotJson,
      parameters: args.evaluation.parameterSnapshot,
      lastFinalClose: args.snapshot.lastFinalClose,
      lastFinalOpenTimeUtc: args.snapshot.lastFinalOpenTimeUtc.toISOString(),
    },
    evidenceJson: {
      ...args.current.evidenceJson,
      ...args.evaluation.evidence,
      score,
    },
  };
  if (!target) {
    return { next: patched, changed: false, event: null };
  }
  if (!canTransition({ from: args.current.state, to: target })) {
    return { next: patched, changed: false, event: null };
  }
  const transitioned = applyTimestamps({ record: patched, state: target, now: args.now });
  transitioned.evidenceJson = appendTransition({ record: transitioned, state: target, at: args.now, evidence: args.evaluation.evidence });
  return { next: transitioned, changed: true, event: "SIGNAL_STATE_CHANGED" };
}

export function dismissSignal(args: { current: SignalRecord; now: Date }): TransitionResult {
  if (isTerminalSignalState({ state: args.current.state }) || !canTransition({ from: args.current.state, to: "DISMISSED" })) {
    return { next: args.current, changed: false, event: null };
  }
  const next = applyTimestamps({ record: args.current, state: "DISMISSED", now: args.now });
  next.evidenceJson = appendTransition({ record: next, state: "DISMISSED", at: args.now, evidence: { reason: "user-dismiss" } });
  return { next, changed: true, event: "SIGNAL_STATE_CHANGED" };
}

export function createPlanStub(args: { current: SignalRecord; now: Date }): TransitionResult {
  if (args.current.state !== "CONFIRMED") {
    return { next: args.current, changed: false, event: null };
  }
  const next = applyTimestamps({ record: args.current, state: "TRADE_PLANNED", now: args.now });
  next.evidenceJson = appendTransition({
    record: next,
    state: "TRADE_PLANNED",
    at: args.now,
    evidence: { plan: { status: "STUB", signalId: args.current.id } },
  });
  next.snapshotJson = { ...next.snapshotJson, plan: { status: "STUB", signalId: args.current.id } };
  return { next, changed: true, event: "SIGNAL_STATE_CHANGED" };
}
