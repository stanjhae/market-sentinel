import { BACKTEST_DEFAULTS, isTerminalSignalState, type StructureLabel, type Timeframe } from "@market-sentinel/domain";
import { candleCloseTimeUtc } from "@market-sentinel/domain/candle";
import {
  applySignalTransition,
  emptyEvaluation,
  evaluateAllStrategies,
  type SignalRecord,
} from "@market-sentinel/strategies";
import { buildSnapshotFromPrefix } from "./structure.js";
import { barsElapsed15m, signalKey } from "./sequence.js";
import type { EventLoopResult, InputCandle, ReplayFrame } from "./types.js";

export function selectFinal15m(args: { candles: InputCandle[] }): InputCandle[] {
  return args.candles
    .filter((candle) => candle.timeframe === "15m" && candle.isFinal)
    .slice()
    .sort((left, right) => left.openTimeUtc.getTime() - right.openTimeUtc.getTime());
}

function firstSignalIndex(args: { signalFromIndex?: number }): number {
  const requested = args.signalFromIndex ?? 0;
  return Math.max(requested, BACKTEST_DEFAULTS.indicatorLookback - 1);
}

export async function runEventLoop(args: {
  candles: InputCandle[];
  higher?: Partial<Record<Timeframe, InputCandle[]>>;
  symbol?: string;
  idFactory?: () => string;
  signalFromIndex?: number;
  yieldEvery?: number;
}): Promise<EventLoopResult> {
  const bars15m = selectFinal15m({ candles: args.candles });
  if (bars15m.length === 0) {
    return { frames: [], signals: [], snapshots: [], emptyReason: "no-final-candles", warmupBars: 0 };
  }
  if (bars15m.length < BACKTEST_DEFAULTS.indicatorLookback) {
    return {
      frames: [],
      signals: [],
      snapshots: [],
      emptyReason: "insufficient-history",
      warmupBars: BACKTEST_DEFAULTS.indicatorLookback,
    };
  }
  const warmupBars = firstSignalIndex({ signalFromIndex: args.signalFromIndex });
  if (warmupBars >= bars15m.length) {
    return {
      frames: [],
      signals: [],
      snapshots: [],
      emptyReason: "insufficient-history",
      warmupBars,
    };
  }
  const frames: ReplayFrame[] = [];
  const snapshots = [];
  const open = new Map<string, SignalRecord>();
  const all: SignalRecord[] = [];
  let previousRsi14: string | null = null;
  let previousStructure1h: StructureLabel | null = null;
  let seq = 0;
  const idFactory =
    args.idFactory ??
    (() => {
      seq += 1;
      return `bt-sig-${seq}`;
    });
  const symbol = args.symbol ?? bars15m[0]!.symbol;
  const yieldEvery = args.yieldEvery ?? 0;
  for (let index = 0; index < bars15m.length; index += 1) {
    const prefix = bars15m.slice(0, index + 1);
    const built = buildSnapshotFromPrefix({
      bars15m: prefix,
      higher: args.higher,
      previousRsi14,
      previousStructure1h,
    });
    if (!built) {
      continue;
    }
    const snapshot = built.snapshot;
    previousRsi14 = snapshot.indicators["15m"]?.rsi14 ?? previousRsi14;
    previousStructure1h = snapshot.regimes["1h"]?.structure ?? previousStructure1h;
    snapshots.push(snapshot);
    const evaluateSignals = index >= warmupBars;
    if (evaluateSignals) {
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
          symbol,
        });
        if (!result.next) {
          continue;
        }
        if (isTerminalSignalState({ state: result.next.state })) {
          open.delete(key);
        } else {
          open.set(key, result.next);
        }
        const existing = all.findIndex((signal) => signal.id === result.next!.id);
        if (existing >= 0) {
          all[existing] = result.next;
        } else {
          all.push(result.next);
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
          symbol,
        });
        if (!result.next) {
          continue;
        }
        if (isTerminalSignalState({ state: result.next.state })) {
          open.delete(key);
        } else {
          open.set(key, result.next);
        }
        const existing = all.findIndex((signal) => signal.id === result.next!.id);
        if (existing >= 0) {
          all[existing] = result.next;
        }
      }
      frames.push({
        index: frames.length,
        barIndex: index,
        openTimeUtc: snapshot.lastFinalOpenTimeUtc,
        closeTimeUtc: prefix[prefix.length - 1]!.closeTimeUtc,
        lastFinalClose: snapshot.lastFinalClose,
        signals: [
          ...open.values(),
          ...all.filter(
            (signal) =>
              isTerminalSignalState({ state: signal.state }) &&
              signal.lastEvaluatedOpenTimeUtc.getTime() === snapshot.lastFinalOpenTimeUtc.getTime(),
          ),
        ],
        zones: snapshot.zones,
        regimes: snapshot.regimes,
        indicators: built.indicatorValues,
      });
    }
    if (yieldEvery > 0 && index > 0 && index % yieldEvery === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  return { frames, signals: all, snapshots, emptyReason: null, warmupBars };
}

export function prefixHasNoFuture(args: {
  prefix: Array<{ openTimeUtc: Date }>;
  future: { openTimeUtc: Date } | undefined;
}): boolean {
  if (!args.future || args.prefix.length === 0) {
    return true;
  }
  const lastOpen = args.prefix[args.prefix.length - 1]!.openTimeUtc.getTime();
  const futureOpen = args.future.openTimeUtc.getTime();
  return args.prefix.every((candle) => candle.openTimeUtc.getTime() <= lastOpen && candle.openTimeUtc.getTime() < futureOpen);
}

export function snapshotExcludesFuture(args: {
  snapshot: {
    lastBars: Partial<Record<Timeframe, Array<{ openTimeUtc: Date; timeframe: Timeframe }>>>;
    lastFinalOpenTimeUtc: Date;
  };
  future15m: { openTimeUtc: Date } | undefined;
  asOf: Date;
}): boolean {
  if (!args.future15m) {
    return true;
  }
  const futureOpen = args.future15m.openTimeUtc.getTime();
  const asOf = args.asOf.getTime();
  for (const bars of Object.values(args.snapshot.lastBars)) {
    for (const bar of bars ?? []) {
      if (bar.openTimeUtc.getTime() >= futureOpen) {
        return false;
      }
      const closeTime = candleCloseTimeUtc({ openTimeUtc: bar.openTimeUtc, timeframe: bar.timeframe });
      if (closeTime.getTime() > asOf) {
        return false;
      }
    }
  }
  return args.snapshot.lastFinalOpenTimeUtc.getTime() < futureOpen;
}
