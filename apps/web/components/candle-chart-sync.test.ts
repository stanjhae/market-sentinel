import { describe, expect, it } from "vitest";
import { decideChartSync, overlayLines } from "./candle-chart-sync";

describe("decideChartSync", () => {
  it("sets data and fits once on the first load", () => {
    expect(
      decideChartSync({
        firstOpen: "2026-09-01T12:00:00.000Z",
        lastOpen: "2026-09-01T13:00:00.000Z",
        previousFirstOpen: null,
        previousLastOpen: null,
      }),
    ).toEqual({ mode: "setData", fitContent: true });
  });

  it("updates only the last bar while the window is unchanged", () => {
    expect(
      decideChartSync({
        firstOpen: "2026-09-01T12:00:00.000Z",
        lastOpen: "2026-09-01T13:00:00.000Z",
        previousFirstOpen: "2026-09-01T12:00:00.000Z",
        previousLastOpen: "2026-09-01T13:00:00.000Z",
      }),
    ).toEqual({ mode: "updateLast", fitContent: false });
    expect(
      decideChartSync({
        firstOpen: "2026-09-01T12:00:00.000Z",
        lastOpen: "2026-09-01T13:15:00.000Z",
        previousFirstOpen: "2026-09-01T12:00:00.000Z",
        previousLastOpen: "2026-09-01T13:00:00.000Z",
      }),
    ).toEqual({ mode: "updateLast", fitContent: false });
  });
});

describe("overlayLines", () => {
  it("maps active zones and current indicator levels", () => {
    const lines = overlayLines({
      zones: [
        {
          id: "z1",
          instrumentId: "i",
          symbol: "US30",
          timeframe: "15m",
          type: "SUPPORT",
          source: "AUTO_PIVOT",
          lowerBound: "100",
          upperBound: "101",
          midpoint: "100.5",
          strengthScore: 40,
          touchCount: 2,
          lastTouchedAt: null,
          status: "ACTIVE",
          metadataJson: { why: "pivots" },
        },
      ],
      indicators: {
        instrumentId: "i",
        timeframe: "15m",
        candleOpenTime: "2026-09-01T12:00:00.000Z",
        rsi14: "50",
        atr14: "2",
        ema20: "99",
        ema50: "98",
        ema200: null,
        bbBasis20: "100",
        bbUpper20x2: "104",
        bbLower20x2: "96",
        bbWidth: "0.08",
        trueRange: "2",
        rollingVolatility: "1",
      },
    });
    expect(lines.map((line) => line.id)).toEqual(["z1:mid", "ema20", "ema50", "bbUpper", "bbBasis", "bbLower"]);
    expect(lines[0]?.tone).toBe("support");
  });
});
