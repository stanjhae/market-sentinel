import { describe, expect, it } from "vitest";
import { isTimeframe } from "./index.js";
import {
  CandleBuilder,
  applyTickToCandle,
  candleOpenTimeUtc,
  decideCandleWrite,
  isCandleOpen,
  tickPrice,
  type Candle,
} from "./candle.js";

function candle(args: Partial<Candle> & Pick<Candle, "open" | "high" | "low" | "close">): Candle {
  return {
    instrumentId: "inst-1",
    timeframe: "15m",
    openTimeUtc: new Date("2026-09-01T12:00:00.000Z"),
    closeTimeUtc: new Date("2026-09-01T12:15:00.000Z"),
    volume: null,
    source: "ETORO_STREAM_AGGREGATED",
    isFinal: false,
    revision: 0,
    ...args,
  };
}

describe("UTC candle buckets", () => {
  it("floors 15m and 4h timestamps to UTC boundaries", () => {
    expect(candleOpenTimeUtc({ at: new Date("2026-09-01T12:14:59.000Z"), timeframe: "15m" })).toEqual(
      new Date("2026-09-01T12:00:00.000Z"),
    );
    expect(candleOpenTimeUtc({ at: new Date("2026-09-01T12:15:00.000Z"), timeframe: "15m" })).toEqual(
      new Date("2026-09-01T12:15:00.000Z"),
    );
    expect(candleOpenTimeUtc({ at: new Date("2026-09-01T13:59:00.000Z"), timeframe: "4h" })).toEqual(
      new Date("2026-09-01T12:00:00.000Z"),
    );
  });

  it("treats a candle as open until its exclusive UTC close", () => {
    expect(
      isCandleOpen({
        closeTimeUtc: new Date("2026-09-01T12:15:00.000Z"),
        now: new Date("2026-09-01T12:14:59.000Z"),
      }),
    ).toBe(true);
    expect(
      isCandleOpen({
        closeTimeUtc: new Date("2026-09-01T12:15:00.000Z"),
        now: new Date("2026-09-01T12:15:00.000Z"),
      }),
    ).toBe(false);
  });

  it("accepts only configured timeframes", () => {
    expect(isTimeframe("15m")).toBe(true);
    expect(isTimeframe("1d")).toBe(false);
  });
});

describe("CandleBuilder", () => {
  it("opens, updates, and finalizes exactly once on a UTC bucket roll", () => {
    const builder = new CandleBuilder({ instrumentId: "inst-1", timeframe: "15m" });
    const first = builder.applyTick({ price: "100", at: new Date("2026-09-01T12:01:00.000Z") });
    expect(first.closed).toBeNull();
    expect(first.updated).toMatchObject({ open: "100", high: "100", low: "100", close: "100", isFinal: false });

    builder.applyTick({ price: "104", at: new Date("2026-09-01T12:10:00.000Z") });
    const down = builder.applyTick({ price: "98", at: new Date("2026-09-01T12:12:00.000Z") });
    expect(down.updated).toMatchObject({ open: "100", high: "104", low: "98", close: "98", isFinal: false });

    const rolled = builder.applyTick({ price: "99", at: new Date("2026-09-01T12:15:00.000Z") });
    expect(rolled.closed).toMatchObject({
      open: "100",
      high: "104",
      low: "98",
      close: "98",
      isFinal: true,
      openTimeUtc: new Date("2026-09-01T12:00:00.000Z"),
    });
    expect(rolled.updated).toMatchObject({
      open: "99",
      close: "99",
      isFinal: false,
      openTimeUtc: new Date("2026-09-01T12:15:00.000Z"),
    });
  });

  it("keeps live ticks when merging a REST seed for the same UTC bucket", () => {
    const builder = new CandleBuilder({ instrumentId: "inst-1", timeframe: "15m" });
    builder.applyTick({ price: "104", at: new Date("2026-09-01T12:10:00.000Z") });
    builder.mergeSeed({
      candle: candle({
        open: "100",
        high: "101",
        low: "99",
        close: "100.5",
        source: "ETORO_REST",
      }),
    });
    expect(builder.getCurrent()).toMatchObject({
      open: "104",
      high: "104",
      low: "99",
      close: "104",
      source: "ETORO_STREAM_AGGREGATED",
    });
  });

  it("does not replace a live builder with a REST seed from another bucket", () => {
    const builder = new CandleBuilder({ instrumentId: "inst-1", timeframe: "15m" });
    builder.applyTick({ price: "104", at: new Date("2026-09-01T12:10:00.000Z") });
    builder.mergeSeed({
      candle: candle({
        open: "90",
        high: "91",
        low: "89",
        close: "90",
        source: "ETORO_REST",
        openTimeUtc: new Date("2026-09-01T11:45:00.000Z"),
        closeTimeUtc: new Date("2026-09-01T12:00:00.000Z"),
      }),
    });
    expect(builder.getCurrent()?.openTimeUtc).toEqual(new Date("2026-09-01T12:00:00.000Z"));
    expect(builder.getCurrent()?.close).toBe("104");
  });

  it("does not re-close a seeded finalized candle", () => {
    const result = applyTickToCandle({
      current: candle({ open: "1", high: "1", low: "1", close: "1", isFinal: true }),
      instrumentId: "inst-1",
      timeframe: "15m",
      price: "2",
      at: new Date("2026-09-01T12:20:00.000Z"),
    });
    expect(result.closed).toBeNull();
    expect(result.updated.openTimeUtc).toEqual(new Date("2026-09-01T12:15:00.000Z"));
  });

  it("prefers last, then mid, then a single side for tick price", () => {
    expect(tickPrice({ last: "10", bid: "9", ask: "11" })).toBe("10");
    expect(tickPrice({ last: null, bid: "9", ask: "11" })).toBe("10");
    expect(tickPrice({ last: null, bid: "9", ask: null })).toBe("9");
    expect(tickPrice({ last: null, bid: null, ask: null })).toBeNull();
  });
});

describe("decideCandleWrite", () => {
  it("inserts when nothing is stored", () => {
    expect(decideCandleWrite({ existing: null, incoming: candle({ open: "1", high: "1", low: "1", close: "1" }) })).toEqual({
      action: "insert",
      revision: 0,
    });
  });

  it("does not let REST overwrite a stream-owned open candle", () => {
    const open = candle({
      open: "100",
      high: "104",
      low: "98",
      close: "102",
      isFinal: false,
      source: "ETORO_STREAM_AGGREGATED",
    });
    expect(
      decideCandleWrite({
        existing: open,
        incoming: { ...open, high: "101", low: "99", close: "100", source: "ETORO_REST" },
      }).action,
    ).toBe("ignore");
  });

  it("updates an open candle and ignores stream writes against a final", () => {
    const open = candle({ open: "1", high: "2", low: "1", close: "2", isFinal: false });
    expect(decideCandleWrite({ existing: open, incoming: { ...open, close: "3", high: "3" } }).action).toBe("update");

    const finalCandle = { ...open, isFinal: true };
    expect(
      decideCandleWrite({
        existing: finalCandle,
        incoming: { ...finalCandle, close: "9", source: "ETORO_STREAM_AGGREGATED" },
      }).action,
    ).toBe("ignore");
  });

  it("revises a final candle only when official REST differs materially", () => {
    const existing = candle({
      open: "100",
      high: "101",
      low: "99",
      close: "100.5",
      isFinal: true,
      source: "ETORO_STREAM_AGGREGATED",
      revision: 0,
    });
    const rest = {
      ...existing,
      close: "101",
      high: "101",
      source: "ETORO_REST" as const,
    };
    expect(decideCandleWrite({ existing, incoming: rest })).toEqual({ action: "revise", revision: 1 });
    expect(
      decideCandleWrite({
        existing,
        incoming: { ...existing, source: "ETORO_REST", close: "100.5" },
      }).action,
    ).toBe("ignore");
  });
});
