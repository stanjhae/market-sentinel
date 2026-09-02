import { BACKTEST_DEFAULTS, type WalkForwardMode } from "@market-sentinel/domain";
import { simulateFills } from "./fills.js";
import { runEventLoop, selectFinal15m } from "./event-loop.js";
import { metricsFromTrades } from "./metrics.js";
import { resolveCosts } from "./costs.js";
import type { BacktestCosts, EventLoopResult, InputCandle, WalkForwardWindow } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function rangeMs(args: { from: Date; to: Date }): number {
  return args.to.getTime() - args.from.getTime();
}

export function walkForwardWindows(args: {
  from: Date;
  to: Date;
  mode: WalkForwardMode;
}): Array<{ kind: "in-sample" | "out-of-sample"; from: Date; to: Date }> {
  const span = rangeMs({ from: args.from, to: args.to });
  if (span <= 0 || args.mode === "none") {
    return [];
  }
  if (args.mode === "split" || span < BACKTEST_DEFAULTS.rollingMinRangeDays * DAY_MS) {
    const splitAt = new Date(args.from.getTime() + span * BACKTEST_DEFAULTS.inSampleRatio);
    return [
      { kind: "in-sample", from: args.from, to: splitAt },
      { kind: "out-of-sample", from: splitAt, to: args.to },
    ];
  }
  const windows: Array<{ kind: "in-sample" | "out-of-sample"; from: Date; to: Date }> = [];
  const isMs = BACKTEST_DEFAULTS.rollingInSampleDays * DAY_MS;
  const oosMs = BACKTEST_DEFAULTS.rollingOutSampleDays * DAY_MS;
  const stepMs = BACKTEST_DEFAULTS.rollingStepDays * DAY_MS;
  for (let start = args.from.getTime(); start + isMs + oosMs <= args.to.getTime(); start += stepMs) {
    const isEnd = new Date(start + isMs);
    const oosEnd = new Date(start + isMs + oosMs);
    windows.push({ kind: "in-sample", from: new Date(start), to: isEnd });
    windows.push({ kind: "out-of-sample", from: isEnd, to: oosEnd });
  }
  return windows;
}

export function windowBarBounds(args: {
  bars: InputCandle[];
  from: Date;
  to: Date;
}): { start: number; lastInclusive: number } | null {
  const start = args.bars.findIndex((bar) => bar.openTimeUtc.getTime() >= args.from.getTime());
  if (start < 0) {
    return null;
  }
  const exclusiveEnd = args.bars.findIndex((bar) => bar.openTimeUtc.getTime() >= args.to.getTime());
  const lastInclusive = exclusiveEnd === -1 ? args.bars.length - 1 : exclusiveEnd - 1;
  if (lastInclusive < start) {
    return null;
  }
  return { start, lastInclusive };
}

export function scoreWalkForwardWindows(args: {
  bars15m: InputCandle[];
  signals: EventLoopResult["signals"];
  windows: Array<{ kind: "in-sample" | "out-of-sample"; from: Date; to: Date }>;
  costs: BacktestCosts;
}): WalkForwardWindow[] {
  return args.windows.map((window) => {
    const bounds = windowBarBounds({ bars: args.bars15m, from: window.from, to: window.to });
    if (!bounds) {
      return {
        kind: window.kind,
        from: window.from,
        to: window.to,
        trades: [],
        metrics: metricsFromTrades({ trades: [], setupCount: 0 }),
      };
    }
    const windowBars = args.bars15m.slice(0, bounds.lastInclusive + 1);
    const trades = simulateFills({
      signals: args.signals,
      bars15m: windowBars,
      costs: args.costs,
      untilIndex: bounds.lastInclusive,
    }).filter((trade) => {
      if (!trade.openedAt) {
        return trade.status === "unfillable";
      }
      return trade.openedAt.getTime() >= window.from.getTime() && trade.openedAt.getTime() < window.to.getTime();
    });
    const setups = new Set(
      args.signals
        .filter((signal) => {
          if (!signal.confirmedAt) {
            return false;
          }
          const at = signal.confirmedAt.getTime();
          return at >= window.from.getTime() && at < window.to.getTime();
        })
        .map((signal) => `${signal.strategyKey}@${signal.strategyVersion}`),
    );
    return {
      kind: window.kind,
      from: window.from,
      to: window.to,
      trades,
      metrics: metricsFromTrades({ trades, setupCount: setups.size }),
    };
  });
}

export async function runWalkForward(args: {
  candles: InputCandle[];
  mode: WalkForwardMode;
  costs?: Partial<BacktestCosts>;
  symbol?: string;
  from?: Date;
  to?: Date;
  loop?: EventLoopResult;
  higher?: Parameters<typeof runEventLoop>[0]["higher"];
}): Promise<WalkForwardWindow[]> {
  const bars = selectFinal15m({ candles: args.candles });
  if (bars.length === 0) {
    return [];
  }
  const from = args.from ?? bars[0]!.openTimeUtc;
  const to = args.to ?? bars[bars.length - 1]!.closeTimeUtc;
  const costs = resolveCosts({ costs: args.costs });
  const windows = walkForwardWindows({ from, to, mode: args.mode });
  if (windows.length === 0) {
    return [];
  }
  const loop =
    args.loop ??
    (await runEventLoop({
      candles: args.candles,
      higher: args.higher,
      symbol: args.symbol,
    }));
  return scoreWalkForwardWindows({
    bars15m: bars,
    signals: loop.signals,
    windows,
    costs,
  });
}
