import { describe, expect, it } from "vitest";
import { flattenHistoryCandles } from "./candles.js";
import { instrumentCandleHistoryPath } from "./routes.js";

describe("instrument candle history", () => {
  it("builds the OpenAPI path and clamps count to 1000", () => {
    expect(
      instrumentCandleHistoryPath({
        instrumentId: 27,
        direction: "desc",
        interval: "FourHours",
        candlesCount: 5000,
      }),
    ).toBe("/api/v1/market-data/instruments/27/history/candles/desc/FourHours/1000");
  });

  it("drops incomplete OHLC rows and sorts by fromDate", () => {
    const candles = flattenHistoryCandles({
      fallbackInstrumentId: 27,
      data: {
        candles: [
          {
            candles: [
              { fromDate: "2026-09-01T13:00:00Z", open: 2, high: 3, low: 1, close: 2 },
              { fromDate: "2026-09-01T12:00:00Z", open: 1, high: 1, low: 1, close: 1 },
              { fromDate: "2026-09-01T11:00:00Z", open: 1, high: 1, low: 1 },
            ],
          },
        ],
      },
    });
    expect(candles.map((item) => item.fromDate)).toEqual([
      "2026-09-01T12:00:00Z",
      "2026-09-01T13:00:00Z",
    ]);
  });
});
