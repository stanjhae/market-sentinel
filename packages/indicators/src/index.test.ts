import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { RSI_FIXTURE_CLOSES } from "@market-sentinel/test-fixtures";
import {
  atrWilderSeries,
  bollinger,
  candleGeometry,
  computeIndicatorSnapshot,
  distanceFromZoneInAtr,
  emaSeries,
  rsiWilderSeries,
} from "./math.js";

describe("RSI 14 Wilder", () => {
  it("returns 100 on a strictly rising series and 50 when price is flat", () => {
    const rising = Array.from({ length: 15 }, (_, index) => String(index + 1));
    const lastRise = rsiWilderSeries({ closes: rising, period: 14 }).at(-1);
    expect(lastRise?.toString()).toBe("100");

    const flat = Array.from({ length: 15 }, () => "10");
    expect(rsiWilderSeries({ closes: flat, period: 14 }).at(-1)?.toString()).toBe("50");
  });

  it("matches the StockCharts Wilder seed on the public close fixture", () => {
    const series = rsiWilderSeries({ closes: [...RSI_FIXTURE_CLOSES], period: 14 });
    const first = series[14];
    expect(first).toBeTruthy();
    expect(first?.toDecimalPlaces(3).toString()).toBe("70.464");
  });
});

describe("EMA / ATR / Bollinger", () => {
  it("seeds EMA with SMA then applies the standard k=2/(n+1) step", () => {
    const series = emaSeries({ values: ["1", "2", "3", "4"], period: 3 });
    expect(series[2]?.toString()).toBe("2");
    expect(series[3]?.toString()).toBe("3");
  });

  it("uses Wilder smoothing for ATR after a 14-bar true-range seed", () => {
    const bars = Array.from({ length: 16 }, (_, index) => ({
      open: String(10 + index),
      high: String(11 + index),
      low: String(9 + index),
      close: String(10.5 + index),
    }));
    const series = atrWilderSeries({ bars, period: 14 });
    expect(series[13]).toBeNull();
    expect(series[14]?.gt(0)).toBe(true);
    expect(series[15]?.gt(0)).toBe(true);
  });

  it("computes population Bollinger bands 20x2", () => {
    const closes = Array.from({ length: 20 }, (_, index) => (index < 10 ? "2" : "4"));
    const bands = bollinger({ closes, period: 20, multiplier: 2 });
    expect(bands.basis?.toString()).toBe("3");
    expect(bands.upper && bands.lower && bands.basis).toBeTruthy();
    expect(bands.upper?.gte(bands.basis ?? 0)).toBe(true);
    expect(bands.lower?.lte(bands.basis ?? 0)).toBe(true);
    const expectedStdev = new Decimal(1);
    expect(bands.stdev?.eq(expectedStdev)).toBe(true);
    expect(bands.upper?.toString()).toBe("5");
    expect(bands.lower?.toString()).toBe("1");
  });
});

describe("candle helpers", () => {
  it("measures body, wicks, and ATR-normalized zone distance", () => {
    const geometry = candleGeometry({
      bar: { open: "10", high: "13", low: "8", close: "11" },
    });
    expect(geometry.bodySize.toString()).toBe("1");
    expect(geometry.upperWick.toString()).toBe("2");
    expect(geometry.lowerWick.toString()).toBe("2");
    expect(distanceFromZoneInAtr({ price: "12", lowerBound: "8", upperBound: "9", atr: "2" })).toBe("1.5");
    expect(distanceFromZoneInAtr({ price: "8.5", lowerBound: "8", upperBound: "9", atr: "2" })).toBe("0");
  });

  it("leaves long-period EMAs null until they are warm", () => {
    const snapshot = computeIndicatorSnapshot({
      bars: Array.from({ length: 30 }, (_, index) => ({
        open: String(10 + index),
        high: String(11 + index),
        low: String(9 + index),
        close: String(10 + index),
      })),
    });
    expect(snapshot.ema20).not.toBeNull();
    expect(snapshot.ema50).toBeNull();
    expect(snapshot.ema200).toBeNull();
    expect(snapshot.rsi14).not.toBeNull();
    expect(snapshot.bodySize).not.toBeNull();
  });
});
