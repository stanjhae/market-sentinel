import { TIMEFRAME_MS } from "@market-sentinel/domain";
import {
  bearishStructureFixture,
  bullishStructureFixture,
  structureBar,
  swingHighFixture,
} from "@market-sentinel/test-fixtures";
import { describe, expect, it } from "vitest";
import {
  applyZoneBreaks,
  classifyRegime,
  classifySetup1h,
  classifySwings,
  classifyTiming15m,
  clusterAutoZones,
  detectConfirmedPivots,
  expireIdleZones,
  mergePriorZones,
  reactionAfterTouch,
  scoreZoneStrength,
  structureFromSwings,
} from "./index.js";
import type { PriceZone } from "./types.js";

describe("detectConfirmedPivots", () => {
  it("keeps a swing high unconfirmed until rightBars final candles exist", () => {
    const short = swingHighFixture().slice(0, 6);
    expect(detectConfirmedPivots({ candles: short })).toEqual([]);
    const confirmed = detectConfirmedPivots({ candles: swingHighFixture() });
    expect(confirmed).toEqual([
      expect.objectContaining({
        type: "HIGH",
        price: "100",
        openTimeUtc: new Date("2026-09-01T00:45:00.000Z"),
      }),
    ]);
  });

  it("never uses an open candle as a confirmation bar", () => {
    const candles = swingHighFixture({ extraBars: 1, openLast: true });
    expect(detectConfirmedPivots({ candles })).toHaveLength(1);
  });

  it("does not change already-confirmed pivots when the series gains one bar", () => {
    const first = detectConfirmedPivots({ candles: swingHighFixture() });
    const next = detectConfirmedPivots({ candles: swingHighFixture({ extraBars: 1 }) });
    expect(next.filter((pivot) => pivot.openTimeUtc.getTime() === first[0]?.openTimeUtc.getTime())).toEqual(first);
  });

  it("skips equal-price plateaus", () => {
    const candles = [90, 91, 92, 100, 100, 100, 91].map((high, index) =>
      structureBar({ index, high: String(high), low: String(high - 4), close: String(high - 1) }),
    );
    expect(detectConfirmedPivots({ candles })).toEqual([]);
  });
});

describe("structure classification", () => {
  it("labels HH+HL as bullish structure", () => {
    const pivots = detectConfirmedPivots({ candles: bullishStructureFixture() });
    const swings = classifySwings({ pivots, atr: "2" });
    expect(structureFromSwings({ swings })).toBe("HH_HL");
    const highs = swings.filter((item) => item.pivot.type === "HIGH").map((item) => item.label);
    const lows = swings.filter((item) => item.pivot.type === "LOW").map((item) => item.label);
    expect(highs.at(-1)).toBe("HH");
    expect(lows.at(-1)).toBe("HL");
  });

  it("labels LH+LL as bearish structure", () => {
    const pivots = detectConfirmedPivots({ candles: bearishStructureFixture() });
    const swings = classifySwings({ pivots, atr: "2" });
    expect(structureFromSwings({ swings })).toBe("LH_LL");
  });

  it("treats equal highs within ATR tolerance as EH and mixed structure", () => {
    const first = {
      instrumentId: "inst-1",
      timeframe: "15m" as const,
      openTimeUtc: new Date("2026-09-01T00:00:00.000Z"),
      type: "HIGH" as const,
      price: "100",
      leftBars: 3,
      rightBars: 3,
    };
    const second = { ...first, openTimeUtc: new Date("2026-09-01T01:00:00.000Z"), price: "100.5" };
    const lowA = { ...first, type: "LOW" as const, price: "90", openTimeUtc: new Date("2026-09-01T00:15:00.000Z") };
    const lowB = { ...lowA, price: "89", openTimeUtc: new Date("2026-09-01T01:15:00.000Z") };
    const swings = classifySwings({ pivots: [first, lowA, second, lowB], atr: "10" });
    expect(swings.find((item) => item.pivot.price === "100.5")?.label).toBe("EH");
    expect(structureFromSwings({ swings })).toBe("MIXED");
  });
});

describe("zones", () => {
  const resistance: PriceZone = {
    instrumentId: "inst-1",
    timeframe: "15m",
    type: "RESISTANCE",
    source: "AUTO_PIVOT",
    lowerBound: "100",
    upperBound: "101",
    midpoint: "100.5",
    strengthScore: 40,
    touchCount: 2,
    lastTouchedAt: new Date("2026-09-01T00:00:00.000Z"),
    status: "ACTIVE",
    metadataJson: { why: "two highs" },
  };

  it("clusters nearby pivot prices and skips manual overlap", () => {
    const pivots = [
      {
        instrumentId: "inst-1",
        timeframe: "15m" as const,
        openTimeUtc: new Date("2026-09-01T00:00:00.000Z"),
        type: "HIGH" as const,
        price: "100",
        leftBars: 3,
        rightBars: 3,
      },
      {
        instrumentId: "inst-1",
        timeframe: "15m" as const,
        openTimeUtc: new Date("2026-09-01T01:00:00.000Z"),
        type: "HIGH" as const,
        price: "100.2",
        leftBars: 3,
        rightBars: 3,
      },
    ];
    const clustered = clusterAutoZones({
      pivots,
      atr: "2",
      existingManual: [],
      instrumentId: "inst-1",
      timeframe: "15m",
    });
    expect(clustered).toHaveLength(1);
    expect(clustered[0]).toMatchObject({ lowerBound: "100", upperBound: "100.2", type: "RESISTANCE" });
    expect(clustered[0]?.lastTouchedAt).toEqual(new Date("2026-09-01T01:00:00.000Z"));
    const laterCheaper = clusterAutoZones({
      pivots: [
        { ...pivots[0]!, price: "100.2", openTimeUtc: new Date("2026-09-01T00:00:00.000Z") },
        { ...pivots[1]!, price: "100", openTimeUtc: new Date("2026-09-01T01:00:00.000Z") },
      ],
      atr: "2",
      existingManual: [],
      instrumentId: "inst-1",
      timeframe: "15m",
    });
    expect(laterCheaper[0]?.lastTouchedAt).toEqual(new Date("2026-09-01T01:00:00.000Z"));
    const skipped = clusterAutoZones({
      pivots,
      atr: "2",
      existingManual: [{ ...resistance, source: "USER_MANUAL", lowerBound: "99.9", upperBound: "100.3" }],
      instrumentId: "inst-1",
      timeframe: "15m",
    });
    expect(skipped).toEqual([]);
  });

  it("does not break a zone on a wick-only penetration", () => {
    const candle = structureBar({
      index: 0,
      high: "104",
      low: "99",
      open: "100",
      close: "101.2",
    });
    const next = applyZoneBreaks({
      zones: [{ ...resistance, lastTouchedAt: new Date("2026-08-31T00:00:00.000Z") }],
      candles: [candle],
      atr: "10",
    });
    expect(next[0]?.status).toBe("ACTIVE");
    expect(next[0]?.metadataJson.lastReaction).toBe("wick touch without close penetration");
    expect(next[0]?.touchCount).toBe(3);
  });

  it("does not increment wick touches twice on the same last candle", () => {
    const candle = structureBar({
      index: 0,
      high: "104",
      low: "99",
      open: "100",
      close: "101.2",
    });
    const first = applyZoneBreaks({
      zones: [{ ...resistance, lastTouchedAt: new Date("2026-08-31T00:00:00.000Z") }],
      candles: [candle],
      atr: "10",
    });
    const second = applyZoneBreaks({ zones: first, candles: [candle], atr: "10" });
    expect(first[0]?.touchCount).toBe(3);
    expect(second[0]?.touchCount).toBe(3);
    expect(second[0]?.metadataJson.weakTouches).toBe(first[0]?.metadataJson.weakTouches);
  });

  it("breaks only when a close crosses beyond the zone, then flips on a later far-side close", () => {
    const inside = structureBar({ index: 0, high: "101", low: "99", open: "100", close: "100.5" });
    const beyond = structureBar({ index: 1, high: "104", low: "100", open: "101", close: "103" });
    const stillBeyond = structureBar({ index: 2, high: "105", low: "103", open: "103.5", close: "104" });
    const broken = applyZoneBreaks({ zones: [resistance], candles: [inside, beyond], atr: "10" });
    expect(broken[0]?.status).toBe("BROKEN");
    const sameClose = applyZoneBreaks({ zones: broken, candles: [inside, beyond], atr: "10" });
    expect(sameClose[0]?.status).toBe("BROKEN");
    const flipped = applyZoneBreaks({ zones: broken, candles: [inside, beyond, stillBeyond], atr: "10" });
    expect(flipped[0]?.status).toBe("FLIPPED");
    expect(flipped[0]?.type).toBe("SUPPORT");
  });

  it("does not break a distant zone just because the last close is already beyond it", () => {
    const below = [
      structureBar({ index: 0, high: "91", low: "89", open: "90", close: "90" }),
      structureBar({ index: 1, high: "92", low: "89", open: "90", close: "91" }),
    ];
    const next = applyZoneBreaks({ zones: [resistance], candles: below, atr: "10" });
    expect(next[0]?.status).toBe("ACTIVE");
  });

  it("preserves prior-zone BROKEN/FLIPPED status across merge", () => {
    const incoming = {
      ...resistance,
      source: "PRIOR_DAY" as const,
      type: "SUPPORT" as const,
      status: "ACTIVE" as const,
      metadataJson: { periodKey: "2026-08-31", why: "PRIOR_DAY low" },
    };
    const existing = {
      ...incoming,
      id: "prior-1",
      status: "BROKEN" as const,
      metadataJson: { periodKey: "2026-08-31", why: "PRIOR_DAY low", lastProcessedOpenTime: "2026-09-01T00:00:00.000Z" },
    };
    const merged = mergePriorZones({ existing: [existing], incoming: [incoming] });
    expect(merged[0]).toMatchObject({
      id: "prior-1",
      status: "BROKEN",
      metadataJson: expect.objectContaining({ lastProcessedOpenTime: "2026-09-01T00:00:00.000Z" }),
    });
    const flippedExisting = {
      ...incoming,
      id: "prior-flip",
      status: "FLIPPED" as const,
      type: "RESISTANCE" as const,
      metadataJson: { periodKey: "2026-08-31", why: "PRIOR_DAY low" },
    };
    const flipped = mergePriorZones({ existing: [flippedExisting], incoming: [incoming] });
    expect(flipped[0]).toMatchObject({ id: "prior-flip", status: "FLIPPED", type: "RESISTANCE" });
  });

  it("expires an idle weak auto zone after 200 bars", () => {
    const expired = expireIdleZones({
      zones: [
        {
          ...resistance,
          lastTouchedAt: new Date("2026-08-01T00:00:00.000Z"),
          strengthScore: 10,
        },
      ],
      lastOpenTime: new Date("2026-09-01T00:00:00.000Z"),
      barMs: 15 * 60 * 1000,
    });
    expect(expired[0]?.status).toBe("EXPIRED");
  });

  it("scores a 0.5 ATR reaction after the last touch", () => {
    const zone = { ...resistance, lastTouchedAt: new Date("2026-09-01T00:00:00.000Z") };
    const candles = [
      structureBar({ index: 0, high: "101", low: "99", open: "100", close: "100" }),
      structureBar({ index: 1, high: "110", low: "100", open: "101", close: "108" }),
    ];
    expect(reactionAfterTouch({ zone, candles, atr: "10" })).toBe("0.9");
    expect(
      scoreZoneStrength({
        zone,
        multiTimeframe: false,
        lastBarOpen: new Date("2026-09-01T00:15:00.000Z"),
        barMs: 15 * 60 * 1000,
        reactionAtr: "0.9",
      }),
    ).toBeGreaterThan(
      scoreZoneStrength({
        zone,
        multiTimeframe: false,
        lastBarOpen: new Date("2026-09-01T00:15:00.000Z"),
        barMs: 15 * 60 * 1000,
      }),
    );
  });
});

describe("classifyRegime", () => {
  it("emits HH_HL and a bullish trend from confirmed bullish swings", () => {
    const candles = bullishStructureFixture();
    const pivots = detectConfirmedPivots({ candles });
    const swings = classifySwings({ pivots, atr: "2" });
    const last = candles[candles.length - 1];
    const regime = classifyRegime({
      instrumentId: "inst-1",
      timeframe: "15m",
      timestamp: last?.openTimeUtc ?? new Date(),
      swings,
      atrSeries: Array.from({ length: 20 }, () => "2"),
      close: last?.close ?? "110",
      zones: [],
    });
    expect(regime.structure).toBe("HH_HL");
    expect(["BULL", "STRONG_BULL"]).toContain(regime.trend);
    expect(regime.location).toBe("MID_RANGE");
  });
});

describe("15m timing", () => {
  it("flags a rejection wick at resistance", () => {
    const zone: PriceZone = {
      instrumentId: "inst-1",
      timeframe: "15m",
      type: "RESISTANCE",
      source: "AUTO_PIVOT",
      lowerBound: "100",
      upperBound: "101",
      midpoint: "100.5",
      strengthScore: 40,
      touchCount: 1,
      lastTouchedAt: null,
      status: "ACTIVE",
      metadataJson: {},
    };
    const flags = classifyTiming15m({
      bars: [
        structureBar({ index: 0, high: "100", low: "99", open: "99.2", close: "99.8" }),
        structureBar({ index: 1, high: "104", low: "99.5", open: "100", close: "100.2" }),
      ],
      indicators: { rsi14: "48", atr14: "2", bbBasis20: "100", bbUpper20x2: "104", bbLower20x2: "96" },
      zones: [zone],
    });
    expect(flags.rejection).toBe(true);
  });

  it("flags rsiReset only when previous RSI is supplied", () => {
    const bars = [
      structureBar({ index: 0, high: "100", low: "99", open: "99.2", close: "99.8" }),
      structureBar({ index: 1, high: "101", low: "99.5", open: "100", close: "100.2" }),
    ];
    const withoutPrevious = classifyTiming15m({
      bars,
      indicators: { rsi14: "36", atr14: "2", bbBasis20: "100", bbUpper20x2: "104", bbLower20x2: "96" },
      zones: [],
    });
    expect(withoutPrevious.rsiReset).toBe(false);
    const withPrevious = classifyTiming15m({
      bars,
      indicators: {
        rsi14: "36",
        previousRsi14: "28",
        atr14: "2",
        bbBasis20: "100",
        bbUpper20x2: "104",
        bbLower20x2: "96",
      },
      zones: [],
    });
    expect(withPrevious.rsiReset).toBe(true);
  });
});

describe("1h setup", () => {
  it("uses the nearest resistance for breakout, not the first zone in the array", () => {
    const far = {
      instrumentId: "inst-1",
      timeframe: "1h" as const,
      type: "RESISTANCE" as const,
      source: "PRIOR_WEEK" as const,
      lowerBound: "200",
      upperBound: "201",
      midpoint: "200.5",
      strengthScore: 30,
      touchCount: 1,
      lastTouchedAt: null,
      status: "ACTIVE" as const,
      metadataJson: {},
    };
    const near = { ...far, source: "AUTO_PIVOT" as const, lowerBound: "102", upperBound: "103", midpoint: "102.5" };
    const flags = classifySetup1h({
      regime: {
        instrumentId: "inst-1",
        timeframe: "1h",
        timestamp: new Date("2026-09-01T00:00:00.000Z"),
        trend: "BULL",
        structure: "HH_HL",
        volatility: "NORMAL",
        location: "MID_RANGE",
        confidence: 70,
        evidenceJson: {},
      },
      previousStructure: "MIXED",
      close: "105",
      zones: [far, near],
      atr: "10",
    });
    expect(flags.breakout).toBe(true);
    const farOnlyBeyond = classifySetup1h({
      regime: {
        instrumentId: "inst-1",
        timeframe: "1h",
        timestamp: new Date("2026-09-01T00:00:00.000Z"),
        trend: "BULL",
        structure: "HH_HL",
        volatility: "NORMAL",
        location: "MID_RANGE",
        confidence: 70,
        evidenceJson: {},
      },
      previousStructure: null,
      close: "90",
      zones: [far, near],
      atr: "10",
    });
    expect(farOnlyBeyond.breakout).toBe(false);
  });
});

describe("defaults", () => {
  it("uses a 15m bar size of 15 minutes for expiry math", () => {
    expect(TIMEFRAME_MS["15m"]).toBe(15 * 60 * 1000);
  });
});
