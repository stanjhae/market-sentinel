import { CandleBuilder } from "@market-sentinel/domain/candle";
import { describe, expect, it } from "vitest";
import { adoptCandleBuilder, historyToCandle, INDICATOR_LOOKBACK } from "./candle-store.js";

describe("historyToCandle", () => {
  it("marks a still-open UTC bucket as not final", () => {
    const candle = historyToCandle({
      history: {
        etoroInstrumentId: 27,
        fromDate: "2026-09-01T12:00:00.000Z",
        open: "1",
        high: "2",
        low: "0.5",
        close: "1.5",
        volume: "0",
      },
      instrumentId: "inst-1",
      timeframe: "15m",
      now: new Date("2026-09-01T12:10:00.000Z"),
    });
    expect(candle.isFinal).toBe(false);
    expect(candle.source).toBe("ETORO_REST");
    expect(candle.closeTimeUtc).toEqual(new Date("2026-09-01T12:15:00.000Z"));
  });

  it("finalizes a bucket whose exclusive close has passed", () => {
    const candle = historyToCandle({
      history: {
        etoroInstrumentId: 27,
        fromDate: "2026-09-01T12:00:00.000Z",
        open: "1",
        high: "2",
        low: "0.5",
        close: "1.5",
        volume: null,
      },
      instrumentId: "inst-1",
      timeframe: "15m",
      now: new Date("2026-09-01T12:15:00.000Z"),
    });
    expect(candle.isFinal).toBe(true);
  });

  it("normalizes REST fromDate onto the UTC timeframe bucket", () => {
    const candle = historyToCandle({
      history: {
        etoroInstrumentId: 27,
        fromDate: "2026-09-01T12:07:33.000Z",
        open: "1",
        high: "2",
        low: "0.5",
        close: "1.5",
        volume: null,
      },
      instrumentId: "inst-1",
      timeframe: "15m",
      now: new Date("2026-09-01T12:10:00.000Z"),
    });
    expect(candle.openTimeUtc).toEqual(new Date("2026-09-01T12:00:00.000Z"));
    expect(candle.closeTimeUtc).toEqual(new Date("2026-09-01T12:15:00.000Z"));
  });

  it("looks back far enough for EMA 200 plus RSI warmup", () => {
    expect(INDICATOR_LOOKBACK).toBeGreaterThanOrEqual(200 + 14);
    expect(INDICATOR_LOOKBACK).toBe(228);
  });
});

describe("adoptCandleBuilder", () => {
  it("merges a REST seed into an existing live builder instead of replacing it", () => {
    const builders = new Map<string, CandleBuilder>();
    const live = new CandleBuilder({ instrumentId: "inst-1", timeframe: "15m" });
    live.applyTick({ price: "104", at: new Date("2026-09-01T12:10:00.000Z") });
    builders.set("US30:15m", live);

    const rest = new CandleBuilder({ instrumentId: "inst-1", timeframe: "15m" });
    rest.seed({
      candle: {
        instrumentId: "inst-1",
        timeframe: "15m",
        openTimeUtc: new Date("2026-09-01T12:00:00.000Z"),
        closeTimeUtc: new Date("2026-09-01T12:15:00.000Z"),
        open: "100",
        high: "101",
        low: "99",
        close: "100.5",
        volume: null,
        source: "ETORO_REST",
        isFinal: false,
        revision: 0,
      },
    });

    adoptCandleBuilder({ builders, key: "US30:15m", incoming: rest });
    expect(builders.get("US30:15m")).toBe(live);
    expect(live.getCurrent()).toMatchObject({
      open: "104",
      high: "104",
      low: "99",
      close: "104",
      source: "ETORO_STREAM_AGGREGATED",
    });
  });
});
