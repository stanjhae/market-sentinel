import { describe, expect, it } from "vitest";
import { decideChartSync } from "./candle-chart-sync";

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
