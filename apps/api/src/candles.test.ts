import { describe, expect, it } from "vitest";
import {
  CANDLE_QUERY_LIMIT,
  emptyCandles,
  newestThenChronological,
  overlayLiveCandle,
  parseIsoDateQuery,
  parseTimeframeQuery,
} from "./candles.js";

describe("candle query helpers", () => {
  it("defaults a missing timeframe to 15m and rejects unknown values", () => {
    expect(parseTimeframeQuery({ value: "4h" })).toBe("4h");
    expect(parseTimeframeQuery({ value: undefined })).toBe("15m");
    expect(parseTimeframeQuery({ value: "" })).toBe("15m");
    expect(parseTimeframeQuery({ value: "1d" })).toBeNull();
  });

  it("accepts ISO dates and rejects invalid from/to values", () => {
    expect(parseIsoDateQuery({ value: undefined })).toEqual({ ok: true });
    expect(parseIsoDateQuery({ value: "2026-09-01T12:00:00.000Z" })).toEqual({
      ok: true,
      date: new Date("2026-09-01T12:00:00.000Z"),
    });
    expect(parseIsoDateQuery({ value: "not-a-date" }).ok).toBe(false);
    expect(parseIsoDateQuery({ value: "September 1, 2026" }).ok).toBe(false);
    expect(parseIsoDateQuery({ value: "2026-13-40" }).ok).toBe(false);
  });

  it("returns the newest N candles in chronological order", () => {
    const candles = [
      { openTimeUtc: "2026-09-01T10:00:00.000Z" },
      { openTimeUtc: "2026-09-01T12:00:00.000Z" },
      { openTimeUtc: "2026-09-01T11:00:00.000Z" },
      { openTimeUtc: "2026-09-01T13:00:00.000Z" },
    ];
    expect(newestThenChronological({ candles, limit: 2 })).toEqual([
      { openTimeUtc: "2026-09-01T12:00:00.000Z" },
      { openTimeUtc: "2026-09-01T13:00:00.000Z" },
    ]);
    expect(CANDLE_QUERY_LIMIT).toBe(1000);
  });

  it("clips the live overlay to the requested range", () => {
    const history = [
      {
        instrumentId: "inst-1",
        symbol: "US30",
        timeframe: "15m" as const,
        openTimeUtc: "2026-09-01T12:00:00.000Z",
        closeTimeUtc: "2026-09-01T12:15:00.000Z",
        open: "1",
        high: "1",
        low: "1",
        close: "1",
        volume: null,
        source: "ETORO_REST" as const,
        isFinal: true,
        revision: 0,
      },
    ];
    const live = {
      instrumentId: "inst-1",
      symbol: "US30",
      timeframe: "15m" as const,
      openTimeUtc: "2026-09-01T12:15:00.000Z",
      closeTimeUtc: "2026-09-01T12:30:00.000Z",
      open: "1",
      high: "1",
      low: "1",
      close: "1",
      volume: null,
      source: "ETORO_STREAM_AGGREGATED" as const,
      isFinal: false,
      revision: 0,
    };
    expect(
      overlayLiveCandle({
        candles: history,
        live,
        timeframe: "15m",
        from: new Date("2026-09-01T12:00:00.000Z"),
        to: new Date("2026-09-01T12:00:00.000Z"),
      }),
    ).toEqual(history);
    expect(
      overlayLiveCandle({
        candles: history,
        live,
        timeframe: "15m",
      }).map((item) => item.openTimeUtc),
    ).toEqual(["2026-09-01T12:00:00.000Z", "2026-09-01T12:15:00.000Z"]);
  });

  it("returns an unavailable envelope when storage is down", () => {
    expect(emptyCandles({ symbol: "US30", timeframe: "1h" })).toEqual({
      available: false,
      symbol: "US30",
      timeframe: "1h",
      candles: [],
    });
  });
});
