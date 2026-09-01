import { describe, expect, it } from "vitest";
import {
  WATCHLIST,
  DEFAULT_ALERT_SETTINGS,
  alertDedupeKey,
  entryStatusFromState,
  formatAlertCopy,
  isAlertCooldownActive,
  isM6StubAlertType,
  isTerminalSignalState,
  isWatchlistSymbol,
  mapSignalTransitionToAlert,
  mapZoneBreakToAlert,
  opportunityLabelFromScore,
  parseWatchlistSymbol,
  scoreCrossedWatch,
  shouldAlertStreamStale,
  shouldEmitAlert,
  shouldPublishStreamStatus,
  alertSendDecision,
  type Trend,
  type ZoneSource,
} from "./index.js";

describe("WATCHLIST", () => {
  it("contains the four MVP instruments", () => {
    expect(WATCHLIST).toEqual(["US30", "US100", "SPX500", "GOLD"]);
  });

  it("rejects unknown symbols", () => {
    expect(isWatchlistSymbol("BTC")).toBe(false);
    expect(isWatchlistSymbol("US30")).toBe(true);
    expect(isWatchlistSymbol("us30")).toBe(false);
    expect(parseWatchlistSymbol({ value: "us30" })).toBe("US30");
    expect(parseWatchlistSymbol({ value: "btc" })).toBeNull();
  });

  it("maps score buckets and entry status without conflating them", () => {
    expect(opportunityLabelFromScore({ score: 84 })).toBe("Strong");
    expect(entryStatusFromState({ state: "WATCHING" })).toBe("WAITING FOR CONFIRMATION");
    expect(isTerminalSignalState({ state: "INVALIDATED" })).toBe(true);
    expect(isTerminalSignalState({ state: "CONFIRMED" })).toBe(false);
  });

  it("reserves Milestone 3 regime and zone enums", () => {
    const trend: Trend = "STRONG_BULL";
    const source: ZoneSource = "AUTO_PIVOT";
    expect(trend).toBe("STRONG_BULL");
    expect(source).toBe("AUTO_PIVOT");
  });
});

describe("alerts", () => {
  it("builds a stable dedupe key from named parts", () => {
    expect(
      alertDedupeKey({
        type: "WATCHLIST_OPPORTUNITY",
        instrumentId: "inst-1",
        subjectId: "sig-1",
        qualifier: "DETECTED",
      }),
    ).toBe("WATCHLIST_OPPORTUNITY:inst-1:sig-1:DETECTED");
    expect(
      alertDedupeKey({
        type: "MAJOR_LEVEL_APPROACHING",
        instrumentId: "inst-1",
        subjectId: "zone-1",
        qualifier: "AT_SUPPORT:2026-09-02T00:00:00.000Z",
      }),
    ).not.toBe(
      alertDedupeKey({
        type: "MAJOR_LEVEL_APPROACHING",
        instrumentId: "inst-1",
        subjectId: "zone-1",
        qualifier: "AT_SUPPORT:2026-09-02T00:15:00.000Z",
      }),
    );
  });

  it("mutes historical evaluation and Milestone 6 stubs", () => {
    expect(shouldEmitAlert({ streamGate: "historical", type: "WATCHLIST_OPPORTUNITY" })).toBe(false);
    expect(shouldEmitAlert({ streamGate: "live", type: "WATCHLIST_OPPORTUNITY" })).toBe(true);
    expect(shouldEmitAlert({ streamGate: "live", type: "RISK_LIMIT_HIT" })).toBe(false);
    expect(isM6StubAlertType({ type: "POSITION_CLOSED" })).toBe(true);
  });

  it("maps signal transitions without alerting dismissed or planned states", () => {
    expect(
      mapSignalTransitionToAlert({
        previousState: null,
        nextState: "DETECTED",
        strategyKey: "breakdown-retest",
      }),
    ).toBe("WATCHLIST_OPPORTUNITY");
    expect(
      mapSignalTransitionToAlert({
        previousState: null,
        nextState: "DETECTED",
        strategyKey: "do-not-chase",
      }),
    ).toBe("DO_NOT_CHASE");
    expect(
      mapSignalTransitionToAlert({
        previousState: "DETECTED",
        nextState: "WATCHING",
        strategyKey: "breakdown-retest",
      }),
    ).toBe("RETEST_DETECTED");
    expect(
      mapSignalTransitionToAlert({
        previousState: "WATCHING",
        nextState: "CONFIRMED",
        strategyKey: "breakdown-retest",
      }),
    ).toBe("ENTRY_CONFIRMATION");
    expect(
      mapSignalTransitionToAlert({
        previousState: "CONFIRMED",
        nextState: "INVALIDATED",
        strategyKey: "breakdown-retest",
      }),
    ).toBe("SIGNAL_INVALIDATED");
    expect(
      mapSignalTransitionToAlert({
        previousState: "CONFIRMED",
        nextState: "DISMISSED",
        strategyKey: "breakdown-retest",
      }),
    ).toBeNull();
    expect(
      mapSignalTransitionToAlert({
        previousState: "CONFIRMED",
        nextState: "TRADE_PLANNED",
        strategyKey: "breakdown-retest",
      }),
    ).toBeNull();
  });

  it("maps an active-to-broken zone and ignores wick-only status", () => {
    expect(mapZoneBreakToAlert({ previousStatus: "ACTIVE", nextStatus: "BROKEN" })).toBe("PRICE_ZONE_BROKEN");
    expect(mapZoneBreakToAlert({ previousStatus: "ACTIVE", nextStatus: "ACTIVE" })).toBeNull();
    expect(mapZoneBreakToAlert({ previousStatus: "BROKEN", nextStatus: "FLIPPED" })).toBeNull();
  });

  it("requires a Watch-threshold cross with a meaningful delta", () => {
    expect(scoreCrossedWatch({ previousScore: 60, nextScore: 71 })).toBe(true);
    expect(scoreCrossedWatch({ previousScore: 69, nextScore: 70 })).toBe(false);
    expect(scoreCrossedWatch({ previousScore: 80, nextScore: 90 })).toBe(false);
    expect(scoreCrossedWatch({ previousScore: 71, nextScore: 60 })).toBe(false);
    expect(scoreCrossedWatch({ previousScore: null, nextScore: 84 })).toBe(false);
  });

  it("publishes stream status only on a transition", () => {
    expect(shouldPublishStreamStatus({ previousStatus: null, nextStatus: "LIVE" })).toBe(true);
    expect(shouldPublishStreamStatus({ previousStatus: "LIVE", nextStatus: "LIVE" })).toBe(false);
    expect(shouldPublishStreamStatus({ previousStatus: "LIVE", nextStatus: "STALE" })).toBe(true);
  });

  it("emits STREAM_STALE once per episode and resets when freshness clears", () => {
    expect(shouldAlertStreamStale({ episodeActive: false, nextStatus: "STALE" })).toEqual({
      emit: true,
      episodeActive: true,
    });
    expect(shouldAlertStreamStale({ episodeActive: true, nextStatus: "STALE" })).toEqual({
      emit: false,
      episodeActive: true,
    });
    expect(shouldAlertStreamStale({ episodeActive: true, nextStatus: "LIVE" })).toEqual({
      emit: false,
      episodeActive: false,
    });
    expect(shouldAlertStreamStale({ episodeActive: false, nextStatus: "LIVE" })).toEqual({
      emit: false,
      episodeActive: false,
    });
  });

  it("does not persist when muted or cooling down", () => {
    const now = new Date("2026-09-02T00:00:00.000Z");
    const settings = DEFAULT_ALERT_SETTINGS;
    expect(
      alertSendDecision({
        settings,
        type: "WATCHLIST_OPPORTUNITY",
        symbol: "US30",
        lastSentAt: new Date("2026-09-01T23:40:00.000Z"),
        now,
      }),
    ).toBe("cooldown");
    expect(
      alertSendDecision({
        settings: { ...settings, enabled: false },
        type: "WATCHLIST_OPPORTUNITY",
        symbol: "US30",
        lastSentAt: null,
        now,
      }),
    ).toBe("muted");
    expect(
      alertSendDecision({
        settings,
        type: "WATCHLIST_OPPORTUNITY",
        symbol: "US30",
        lastSentAt: null,
        now,
      }),
    ).toBe("send");
  });

  it("treats cooldown as send-suppression only", () => {
    const now = new Date("2026-09-02T00:00:00.000Z");
    expect(
      isAlertCooldownActive({
        lastSentAt: new Date("2026-09-01T23:40:00.000Z"),
        now,
        cooldownMinutes: 30,
      }),
    ).toBe(true);
    expect(
      isAlertCooldownActive({
        lastSentAt: new Date("2026-09-01T23:20:00.000Z"),
        now,
        cooldownMinutes: 30,
      }),
    ).toBe(false);
    expect(isAlertCooldownActive({ lastSentAt: null, now, cooldownMinutes: 30 })).toBe(false);
  });

  it("formats SPEC-style copy without leaking secrets", () => {
    const copy = formatAlertCopy({
      symbol: "US30",
      direction: "SHORT",
      headline: "WATCH",
      score: 84,
      context4h: "4H bearish correction.",
      setup1h: "1H support breakdown.",
      timing: "Price is retesting 53,000-53,080 from below.",
      entryStatus: "Entry confirmation not complete.",
      invalidation: "Invalidation above 53,150.",
      nextLevel: "Next support 52,800.",
    });
    expect(copy.title).toBe("US30 — SHORT WATCH — 84/100");
    expect(copy.body).toContain("4H bearish correction.");
    expect(copy.body).not.toContain("TELEGRAM");
    expect(copy.body).not.toContain("token");
  });
});
