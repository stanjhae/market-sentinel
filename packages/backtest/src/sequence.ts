import { TIMEFRAME_MS, isTerminalSignalState, type SignalDirection, type StrategyKey } from "@market-sentinel/domain";
import {
  applySignalTransition,
  emptyEvaluation,
  evaluateAllStrategies,
  type SignalRecord,
  type StrategySnapshot,
} from "@market-sentinel/strategies";
import type { SequenceStep } from "./types.js";

const OPEN_STATES = ["DETECTED", "WATCHING", "CONFIRMED", "TRADE_PLANNED", "ENTERED"] as const;

export function barsElapsed15m(args: { from: Date; to: Date }): number {
  return Math.max(0, Math.floor((args.to.getTime() - args.from.getTime()) / TIMEFRAME_MS["15m"]));
}

export function signalKey(args: { strategyKey: StrategyKey; direction: SignalDirection }): string {
  return `${args.strategyKey}:${args.direction}`;
}

export function simulateSignalSequence(args: {
  snapshots: StrategySnapshot[];
  symbol?: string;
  idFactory?: () => string;
}): { steps: SequenceStep[]; signals: SignalRecord[] } {
  const open = new Map<string, SignalRecord>();
  const closed: SignalRecord[] = [];
  const steps: SequenceStep[] = [];
  let seq = 0;
  const idFactory = args.idFactory ?? (() => {
    seq += 1;
    return `bt-sig-${seq}`;
  });
  for (const snapshot of args.snapshots) {
    const evaluations = evaluateAllStrategies({ snapshot });
    const processed = new Set<string>();
    for (const evaluation of evaluations) {
      const key = signalKey({ strategyKey: evaluation.strategyKey, direction: evaluation.direction });
      processed.add(key);
      const current = open.get(key) ?? null;
      const lastProgress = current?.watchingAt ?? current?.confirmedAt ?? current?.detectedAt ?? snapshot.lastFinalOpenTimeUtc;
      const result = applySignalTransition({
        current,
        evaluation,
        snapshot,
        now: snapshot.evaluatedAt,
        barsElapsed15m: barsElapsed15m({ from: lastProgress, to: snapshot.lastFinalOpenTimeUtc }),
        idFactory,
        symbol: args.symbol ?? "US30",
      });
      if (!result.next) {
        continue;
      }
      if (isTerminalSignalState({ state: result.next.state })) {
        open.delete(key);
        closed.push(result.next);
      } else {
        open.set(key, result.next);
      }
    }
    for (const [key, current] of open) {
      if (processed.has(key)) {
        continue;
      }
      const result = applySignalTransition({
        current,
        evaluation: emptyEvaluation({
          strategyKey: current.strategyKey,
          snapshot,
          direction: current.direction,
          evidence: { reason: "missing-direction" },
        }),
        snapshot,
        now: snapshot.evaluatedAt,
        barsElapsed15m: barsElapsed15m({
          from: current.watchingAt ?? current.confirmedAt ?? current.detectedAt,
          to: snapshot.lastFinalOpenTimeUtc,
        }),
        idFactory,
        symbol: args.symbol ?? "US30",
      });
      if (!result.next) {
        continue;
      }
      if (isTerminalSignalState({ state: result.next.state })) {
        open.delete(key);
        closed.push(result.next);
      } else {
        open.set(key, result.next);
      }
    }
    steps.push({
      openTimeUtc: snapshot.lastFinalOpenTimeUtc,
      states: [...open.values(), ...closed.filter((signal) => signal.lastEvaluatedOpenTimeUtc.getTime() === snapshot.lastFinalOpenTimeUtc.getTime())].map(
        (signal) => ({
          strategyKey: signal.strategyKey,
          direction: signal.direction,
          state: signal.state,
        }),
      ),
    });
  }
  return { steps, signals: [...closed, ...open.values()] };
}

export function openSignalsOf(args: { signals: SignalRecord[] }): SignalRecord[] {
  return args.signals.filter((signal) => (OPEN_STATES as readonly string[]).includes(signal.state));
}
