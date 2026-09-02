import { BACKTEST_DEFAULTS } from "@market-sentinel/domain";
import { candleCloseTimeUtc } from "@market-sentinel/domain/candle";
import { breakdownRetestReplay, falseBreakdownReplay } from "@market-sentinel/test-fixtures";
import { applySignalTransition, breakdownRetestStrategy, type SignalRecord } from "@market-sentinel/strategies";
import { describe, expect, it } from "vitest";
import { higherPrefix } from "./aggregate.js";
import { prefixHasNoFuture, runEventLoop, snapshotExcludesFuture } from "./event-loop.js";
import { snapshotsFromReplay } from "./fixture-snapshot.js";
import { paperFillAt, simulateFills } from "./fills.js";
import { simulateSignalSequence } from "./sequence.js";
import { buildSnapshotFromPrefix } from "./structure.js";
import { runWalkForward, walkForwardWindows, windowBarBounds } from "./walk-forward.js";
import type { InputCandle } from "./types.js";

function bar(args: { index: number; open: string; high: string; low: string; close: string; final?: boolean }): InputCandle {
  const openTimeUtc = new Date(Date.UTC(2026, 0, 1, 0, args.index * 15));
  return {
    instrumentId: "inst-1",
    symbol: "US30",
    timeframe: "15m",
    openTimeUtc,
    closeTimeUtc: candleCloseTimeUtc({ openTimeUtc, timeframe: "15m" }),
    open: args.open,
    high: args.high,
    low: args.low,
    close: args.close,
    isFinal: args.final ?? true,
  };
}

function series(args: { count: number; start?: number }): InputCandle[] {
  return Array.from({ length: args.count }, (_, index) => {
    const price = String((args.start ?? 100) + (index % 5));
    return bar({
      index,
      open: price,
      high: String(Number(price) + 1),
      low: String(Number(price) - 1),
      close: price,
    });
  });
}

function confirmedLong(args: { id: string; confirm: InputCandle; invalidatedAt?: Date | null }): SignalRecord {
  return {
    id: args.id,
    instrumentId: "inst-1",
    symbol: "US30",
    strategyKey: "breakdown-retest",
    strategyVersion: "1.0.0",
    direction: "LONG",
    state: args.invalidatedAt ? "INVALIDATED" : "CONFIRMED",
    triggerTimeframe: "15m",
    detectedAt: args.confirm.openTimeUtc,
    watchingAt: null,
    confirmedAt: args.confirm.openTimeUtc,
    tradePlannedAt: null,
    enteredAt: null,
    closedAt: null,
    invalidatedAt: args.invalidatedAt ?? null,
    expiredAt: null,
    dismissedAt: null,
    score: 70,
    confidenceLabel: "Watch",
    entryZoneLow: "99",
    entryZoneHigh: "101",
    invalidationPrice: "95",
    target1: "110",
    target2: null,
    target3: null,
    riskRewardToT1: "2",
    riskRewardToT2: null,
    lastEvaluatedOpenTimeUtc: args.confirm.openTimeUtc,
    evidenceJson: {},
    snapshotJson: {},
  };
}

describe("simulateSignalSequence", () => {
  it("matches the live state-machine walk on the breakdown-retest fixture", () => {
    const snapshots = snapshotsFromReplay({ steps: breakdownRetestReplay() });
    const backtest = simulateSignalSequence({ snapshots, symbol: "US30", idFactory: () => "sig-1" });
    let current = null as ReturnType<typeof applySignalTransition>["next"];
    const live = snapshots.map((snapshot) => {
      current = applySignalTransition({
        current,
        evaluation: breakdownRetestStrategy.evaluate({ snapshot }),
        snapshot,
        now: snapshot.evaluatedAt,
        barsElapsed15m: snapshots.indexOf(snapshot),
        idFactory: () => "sig-1",
        symbol: "US30",
      }).next;
      return current?.state;
    });
    const states = backtest.steps.map((step) => step.states.find((item) => item.strategyKey === "breakdown-retest")?.state);
    expect(states).toEqual(live);
    expect(states).toEqual(["DETECTED", "WATCHING", "CONFIRMED"]);
  });

  it("invalidates the false-breakdown fixture", () => {
    const snapshots = snapshotsFromReplay({ steps: falseBreakdownReplay() });
    const result = simulateSignalSequence({ snapshots, symbol: "US30" });
    expect(result.steps.map((step) => step.states.find((item) => item.strategyKey === "breakdown-retest")?.state)).toEqual([
      "DETECTED",
      "INVALIDATED",
    ]);
  });
});

describe("event loop lookahead", () => {
  it("refuses open bars and never reads the next 15m close", async () => {
    const candles = [
      ...series({ count: BACKTEST_DEFAULTS.indicatorLookback }),
      bar({
        index: BACKTEST_DEFAULTS.indicatorLookback,
        open: "110",
        high: "111",
        low: "109",
        close: "110",
        final: false,
      }),
    ];
    const loop = await runEventLoop({ candles });
    expect(loop.emptyReason).toBeNull();
    expect(loop.snapshots.every((snapshot) => snapshot.lastBars["15m"]?.every((item) => item.isFinal))).toBe(true);
    const finals = candles.filter((candle) => candle.isFinal);
    for (let index = 0; index < finals.length; index += 1) {
      const prefix = finals.slice(0, index + 1);
      const current = prefix[prefix.length - 1]!;
      expect(prefixHasNoFuture({ prefix, future: finals[index + 1] })).toBe(true);
      const snapshot = loop.snapshots[index];
      if (snapshot) {
        expect(snapshot.lastFinalOpenTimeUtc.getTime()).toBe(current.openTimeUtc.getTime());
        expect(
          snapshotExcludesFuture({
            snapshot,
            future15m: finals[index + 1],
            asOf: current.closeTimeUtc,
          }),
        ).toBe(true);
        const last15m = snapshot.lastBars["15m"]?.[snapshot.lastBars["15m"]!.length - 1];
        expect(last15m?.openTimeUtc.getTime()).toBe(current.openTimeUtc.getTime());
      }
    }
  }, 20_000);

  it("produces the same signal sequence when the candle loop is run twice", async () => {
    const candles = series({ count: BACKTEST_DEFAULTS.indicatorLookback + 8 });
    const first = await runEventLoop({ candles, idFactory: () => "a" });
    const second = await runEventLoop({ candles, idFactory: () => "a" });
    expect(first.frames.map((frame) => frame.signals.map((signal) => `${signal.strategyKey}:${signal.state}`))).toEqual(
      second.frames.map((frame) => frame.signals.map((signal) => `${signal.strategyKey}:${signal.state}`)),
    );
  }, 20_000);

  it("returns an empty envelope when warmup is missing", async () => {
    expect((await runEventLoop({ candles: series({ count: 10 }) })).emptyReason).toBe("insufficient-history");
    expect((await runEventLoop({ candles: [] })).emptyReason).toBe("no-final-candles");
  });

  it("persists as-of indicators on scored frames", async () => {
    const loop = await runEventLoop({ candles: series({ count: BACKTEST_DEFAULTS.indicatorLookback + 4 }) });
    expect(loop.frames.length).toBeGreaterThan(0);
    expect(loop.frames[0]?.indicators["15m"]?.ema20).toEqual(expect.any(String));
    expect(loop.warmupBars).toBe(BACKTEST_DEFAULTS.indicatorLookback - 1);
  }, 20_000);
});

describe("higher timeframe fallback", () => {
  it("aggregates 1h/4h from 15m when provided higher arrays are empty", () => {
    const bars15m = series({ count: 16 });
    const asOf = bars15m[bars15m.length - 1]!.closeTimeUtc;
    const hourly = higherPrefix({ provided: [], bars15m, timeframe: "1h", asOf });
    expect(hourly.length).toBeGreaterThan(0);
    expect(hourly.every((candle) => candle.timeframe === "1h")).toBe(true);
    const built = buildSnapshotFromPrefix({
      bars15m,
      higher: { "1h": [], "4h": [] },
    });
    expect(built?.snapshot.lastBars["1h"]?.length).toBeGreaterThan(0);
    const lastHour = built?.snapshot.lastBars["1h"]?.[built.snapshot.lastBars["1h"]!.length - 1];
    expect(lastHour?.openTimeUtc.getTime()).toBeLessThan(asOf.getTime());
  });
});

describe("fills", () => {
  it("does not silent-fill a gap through the stop", () => {
    const confirm = bar({ index: 0, open: "100", high: "101", low: "99", close: "100" });
    const gap = bar({ index: 1, open: "90", high: "91", low: "89", close: "90" });
    const trades = simulateFills({
      signals: [confirmedLong({ id: "sig-gap", confirm })],
      bars15m: [confirm, gap],
      costs: { slippage: "0", spread: "0", feeBps: "0", units: "1" },
    });
    expect(trades[0]?.status).toBe("unfillable");
    expect(trades[0]?.unfillableReason).toBe("gap");
    expect(trades[0]?.realizedPnl).toBeNull();
  });

  it("lets the stop win when stop and target print in the same bar", () => {
    const confirm = bar({ index: 0, open: "100", high: "101", low: "99", close: "100" });
    const entry = bar({ index: 1, open: "100", high: "100.2", low: "99.8", close: "100" });
    const both = bar({ index: 2, open: "100", high: "110", low: "94", close: "105" });
    const trades = simulateFills({
      signals: [confirmedLong({ id: "sig-both", confirm })],
      bars15m: [confirm, entry, both],
      costs: { slippage: "0", spread: "0", feeBps: "0", units: "1" },
    });
    expect(trades[0]?.status).toBe("closed");
    expect(trades[0]?.exitReason).toBe("stop");
    expect(trades[0]?.exitPrice).toBe("95");
  });

  it("skips a fill when the setup is invalidated before the entry open", () => {
    const confirm = bar({ index: 0, open: "100", high: "101", low: "99", close: "100" });
    const entry = bar({ index: 1, open: "100", high: "101", low: "99", close: "100" });
    const trades = simulateFills({
      signals: [confirmedLong({ id: "sig-dead", confirm, invalidatedAt: confirm.openTimeUtc })],
      bars15m: [confirm, entry],
      costs: { slippage: "0", spread: "0", feeBps: "0", units: "1" },
    });
    expect(trades).toHaveLength(0);
  });

  it("still fills when invalidation is recorded on the entry bar", () => {
    const confirm = bar({ index: 0, open: "100", high: "101", low: "99", close: "100" });
    const entry = bar({ index: 1, open: "100", high: "101", low: "99", close: "100" });
    const trades = simulateFills({
      signals: [confirmedLong({ id: "sig-live", confirm, invalidatedAt: entry.openTimeUtc })],
      bars15m: [confirm, entry],
      costs: { slippage: "0", spread: "0", feeBps: "0", units: "1" },
    });
    expect(trades[0]?.status).toBe("open");
    expect(trades[0]?.entryPrice).toBe("100");
  });

  it("fills a paper trade at index 0 using that bar's open", () => {
    const first = bar({ index: 0, open: "100", high: "101", low: "99", close: "100" });
    const trade = paperFillAt({
      direction: "LONG",
      stopLoss: "95",
      target1: "110",
      bars15m: [first],
      index: 0,
      costs: { slippage: "0", spread: "0", feeBps: "0", units: "1" },
      id: "paper-0",
    });
    expect(trade.entryPrice).toBe("100");
    expect(trade.entryBarIndex).toBe(0);
  });

  it("ignores non-numeric stop prices instead of filling", () => {
    const confirm = bar({ index: 0, open: "100", high: "101", low: "99", close: "100" });
    const entry = bar({ index: 1, open: "100", high: "101", low: "99", close: "100" });
    const trades = simulateFills({
      signals: [{ ...confirmedLong({ id: "sig-nan", confirm }), invalidationPrice: "abc" }],
      bars15m: [confirm, entry],
      costs: { slippage: "0", spread: "0", feeBps: "0", units: "1" },
    });
    expect(trades).toHaveLength(0);
  });
});

describe("walk-forward", () => {
  it("does not score a split window with bars after the window end", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-04-01T00:00:00.000Z");
    const windows = walkForwardWindows({ from, to, mode: "split" });
    expect(windows).toHaveLength(2);
    expect(windows[0]?.kind).toBe("in-sample");
    expect(windows[1]?.kind).toBe("out-of-sample");
    expect(windows[0]!.to.getTime()).toBeLessThanOrEqual(windows[1]!.from.getTime());
    expect(windows[1]!.to.getTime()).toBe(to.getTime());
    expect(windows[0]!.to.getTime()).toBeLessThan(to.getTime());
  });

  it("emits rolling 90/30 windows when the range is at least 180 days", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-08-01T00:00:00.000Z");
    const windows = walkForwardWindows({ from, to, mode: "rolling" });
    expect(windows.length).toBeGreaterThan(2);
    expect(windows[0]?.kind).toBe("in-sample");
    expect(windows[1]?.kind).toBe("out-of-sample");
    expect(windows[0]!.to.getTime() - windows[0]!.from.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
    expect(windows[1]!.to.getTime() - windows[1]!.from.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("does not fall back to the full series when the window ends before the first bar", () => {
    const bars = series({ count: 8 });
    expect(
      windowBarBounds({
        bars,
        from: new Date("2025-01-01T00:00:00.000Z"),
        to: new Date("2025-01-02T00:00:00.000Z"),
      }),
    ).toBeNull();
  });

  it("includes the last bar when to is that bar's close and excludes a bar at to", () => {
    const bars = series({ count: 8 });
    const last = bars[bars.length - 1]!;
    const inclusive = windowBarBounds({
      bars,
      from: bars[0]!.openTimeUtc,
      to: last.closeTimeUtc,
    });
    expect(inclusive?.lastInclusive).toBe(bars.length - 1);
    const exclusive = windowBarBounds({
      bars,
      from: bars[0]!.openTimeUtc,
      to: last.openTimeUtc,
    });
    expect(exclusive?.lastInclusive).toBe(bars.length - 2);
  });

  it("does not open a walk-forward trade after the window end", async () => {
    const candles = series({ count: BACKTEST_DEFAULTS.indicatorLookback + 20 });
    const from = candles[0]!.openTimeUtc;
    const to = candles[candles.length - 1]!.closeTimeUtc;
    const windows = await runWalkForward({ candles, mode: "split", from, to });
    for (const window of windows) {
      for (const trade of window.trades) {
        if (trade.openedAt) {
          expect(trade.openedAt.getTime()).toBeLessThan(window.to.getTime());
        }
      }
    }
  }, 20_000);
});
