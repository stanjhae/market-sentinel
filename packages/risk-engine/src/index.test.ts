import { DEFAULT_RISK_PROFILE } from "@market-sentinel/domain";
import { describe, expect, it } from "vitest";
import { computeAccountTotals, isUsablePnlSnapshot } from "./account.js";
import { evaluateChecklist, evaluateRisk, tradingStatusFromFlags } from "./evaluate.js";
import { identityChanged, minDateString } from "./money.js";
import { normalizeHistoryItem, normalizePnlPosition } from "./normalize.js";
import { cooldownUntil, correlatedExposureCount, dailyPnl, isBlackoutActive, lastApprovedRiskPct, nextConsecutiveLosses } from "./session.js";
import type { BrokerTrade, EconomicEvent } from "./types.js";

function trade(args: { id: string; pnl: string; closedAt: string }): BrokerTrade {
  return {
    etoroPositionId: args.id,
    instrumentId: 27,
    symbol: "US30",
    direction: "LONG",
    openedAt: "2026-09-01T10:00:00.000Z",
    closedAt: args.closedAt,
    openPrice: "100",
    closePrice: "101",
    units: "1",
    investedAmount: "100",
    leverage: "1",
    stopLoss: "99",
    takeProfit: "103",
    realizedPnl: args.pnl,
    fees: "0",
    sourceAccount: "REAL",
  };
}

describe("account totals", () => {
  it("matches official cash, invested, pnl, and equity formulas", () => {
    const totals = computeAccountTotals({
      portfolio: {
        credit: 1000,
        positions: [{ positionID: 1, amount: 200, unrealizedPnL: { pnL: 25 } }],
        mirrors: [
          {
            availableAmount: 80,
            closedPositionsNetProfit: 10,
            positions: [{ positionID: 2, amount: 50, unrealizedPnL: { pnL: 5 } }],
          },
        ],
        orders: [{ amount: 30 }],
        ordersForOpen: [{ amount: 40, mirrorID: 0, totalExternalCosts: 2 }],
      },
    });
    expect(totals.availableCash).toBe("930");
    expect(totals.invested).toBe("392");
    expect(totals.unrealizedPnl).toBe("40");
    expect(totals.equity).toBe("1362");
    expect(totals.cash).toBe("930");
  });

  it("rejects empty or credit-only PnL payloads", () => {
    expect(isUsablePnlSnapshot({ portfolio: undefined })).toBe(false);
    expect(isUsablePnlSnapshot({ portfolio: {} })).toBe(false);
    expect(isUsablePnlSnapshot({ portfolio: { credit: 1000 } })).toBe(false);
    expect(isUsablePnlSnapshot({ portfolio: { credit: 1000, positions: [] } })).toBe(true);
  });
});

describe("normalize", () => {
  it("keeps PnL capital-suffix and history lowerCamel at the boundary", () => {
    const position = normalizePnlPosition({
      position: {
        positionID: 11,
        instrumentID: 27,
        isBuy: false,
        openRate: 53000,
        units: 0.1,
        amount: 530,
        unrealizedPnL: { pnL: -4.5 },
      },
      symbol: "US30",
    });
    expect(position?.etoroPositionId).toBe("11");
    expect(position?.direction).toBe("SHORT");
    expect(position?.unrealizedPnl).toBe("-4.5");

    const history = normalizeHistoryItem({
      item: { positionId: 11, instrumentId: 27, isBuy: false, netProfit: -12, closeTimestamp: "2026-09-02T00:00:00.000Z" },
      symbol: "US30",
      sourceAccount: "REAL",
    });
    expect(history?.realizedPnl).toBe("-12");
    expect(history?.sourceAccount).toBe("REAL");
  });
});

describe("session risk", () => {
  it("counts UTC-day realized plus current unrealized", () => {
    expect(
      dailyPnl({
        trades: [
          trade({ id: "1", pnl: "-10", closedAt: "2026-09-02T01:00:00.000Z" }),
          trade({ id: "2", pnl: "4", closedAt: "2026-09-01T23:59:00.000Z" }),
        ],
        unrealizedPnl: "-3",
        now: new Date("2026-09-02T12:00:00.000Z"),
      }),
    ).toBe("-13");
  });

  it("counts a consecutive-loss streak from the most recent close", () => {
    expect(
      nextConsecutiveLosses({
        closedTrades: [
          trade({ id: "1", pnl: "8", closedAt: "2026-09-01T10:00:00.000Z" }),
          trade({ id: "2", pnl: "-2", closedAt: "2026-09-01T11:00:00.000Z" }),
          trade({ id: "3", pnl: "-5", closedAt: "2026-09-01T12:00:00.000Z" }),
        ],
      }),
    ).toBe(2);
    expect(
      nextConsecutiveLosses({
        closedTrades: [
          trade({ id: "1", pnl: "-2", closedAt: "2026-09-01T11:00:00.000Z" }),
          trade({ id: "2", pnl: "1", closedAt: "2026-09-01T12:00:00.000Z" }),
        ],
      }),
    ).toBe(0);
  });

  it("uses the later of automatic and manual cooldown", () => {
    const lastLossAt = new Date("2026-09-02T10:00:00.000Z");
    expect(cooldownUntil({ lastLossAt, minutes: 15, manualUntil: null })?.toISOString()).toBe(
      "2026-09-02T10:15:00.000Z",
    );
    expect(
      cooldownUntil({
        lastLossAt,
        minutes: 15,
        manualUntil: new Date("2026-09-02T11:00:00.000Z"),
      })?.toISOString(),
    ).toBe("2026-09-02T11:00:00.000Z");
  });

  it("blocks a blackout window that is closed at the start and open at the end", () => {
    const event: EconomicEvent = {
      id: "cpi",
      eventName: "CPI",
      currency: "USD",
      impact: "HIGH",
      scheduledAtUtc: new Date("2026-09-02T12:00:00.000Z"),
      blackoutBeforeMinutes: 10,
      blackoutAfterMinutes: 10,
    };
    expect(isBlackoutActive({ events: [event], now: new Date("2026-09-02T11:50:00.000Z") })).toBe(true);
    expect(isBlackoutActive({ events: [event], now: new Date("2026-09-02T12:09:00.000Z") })).toBe(true);
    expect(isBlackoutActive({ events: [event], now: new Date("2026-09-02T12:10:00.000Z") })).toBe(false);
    expect(isBlackoutActive({ events: [event], now: new Date("2026-09-02T11:49:00.000Z") })).toBe(false);
  });
});

describe("evaluateRisk", () => {
  const basePlan = {
    symbol: "US30",
    direction: "SHORT" as const,
    plannedEntry: "53000",
    stopLoss: "53100",
    target1: "52800",
    riskPct: "1",
    riskRewardToT1: "2",
  };

  it("blocks daily loss, news blackout, and over-max risk even with a complete checklist", () => {
    const event: EconomicEvent = {
      id: "cpi",
      eventName: "CPI",
      currency: "USD",
      impact: "HIGH",
      scheduledAtUtc: new Date("2026-09-02T12:00:00.000Z"),
      blackoutBeforeMinutes: 10,
      blackoutAfterMinutes: 10,
    };
    const blocked = evaluateRisk({
      profile: DEFAULT_RISK_PROFILE,
      equity: "10000",
      unrealizedPnl: "-400",
      trades: [trade({ id: "1", pnl: "-20", closedAt: "2026-09-02T01:00:00.000Z" })],
      positions: [],
      plans: [],
      events: [event],
      plan: { ...basePlan, riskPct: "2" },
      now: new Date("2026-09-02T11:55:00.000Z"),
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.blockReasons).toContain("daily-loss");
    expect(blocked.blockReasons).toContain("news-blackout");
    expect(blocked.blockReasons).toContain("risk-pct-exceeds-max");
    expect(blocked.tradingStatus).toBe("NEWS_BLACKOUT");
    expect(evaluateChecklist({ checklist: {
      definedEntry: true,
      definedStop: true,
      minimumRr: true,
      notRecovering: true,
      notChasing: true,
      knowHtf: true,
      noBlackoutImminent: true,
      wouldStillTake: true,
    } }).complete).toBe(true);
  });

  it("blocks correlated equity-index exposure and allows a clean plan", () => {
    const correlated = evaluateRisk({
      profile: DEFAULT_RISK_PROFILE,
      equity: "10000",
      unrealizedPnl: "0",
      trades: [],
      positions: [
        {
          etoroPositionId: "1",
          instrumentId: 28,
          symbol: "US100",
          direction: "LONG",
          openedAt: null,
          openPrice: "1",
          units: "1",
          investedAmount: "100",
          leverage: "1",
          stopLoss: null,
          takeProfit: null,
          unrealizedPnl: "0",
          fees: "0",
          mirrorId: 0,
        },
      ],
      plans: [],
      events: [],
      plan: basePlan,
      now: new Date("2026-09-02T12:00:00.000Z"),
    });
    expect(correlated.blockReasons).toContain("correlated-exposure");

    const stalePlan = evaluateRisk({
      profile: DEFAULT_RISK_PROFILE,
      equity: "10000",
      unrealizedPnl: "0",
      trades: [],
      positions: [],
      plans: [
        {
          symbol: "US100",
          gateStatus: "APPROVED",
          riskPct: "1",
          estimatedPositionSize: "100",
          signalState: "INVALIDATED",
          approvedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      events: [],
      plan: basePlan,
      now: new Date("2026-09-02T12:00:00.000Z"),
    });
    expect(stalePlan.allowed).toBe(true);
    expect(
      correlatedExposureCount({
        symbol: "US30",
        positions: [],
        plans: [
          {
            symbol: "US100",
            gateStatus: "APPROVED",
            riskPct: "1",
            estimatedPositionSize: "100",
            signalState: "INVALIDATED",
            approvedAt: "2026-09-01T00:00:00.000Z",
          },
        ],
      }),
    ).toBe(0);
    expect(
      lastApprovedRiskPct({
        plans: [
          { symbol: "US30", gateStatus: "APPROVED", riskPct: "0.5", estimatedPositionSize: null, signalState: "TRADE_PLANNED", approvedAt: "2026-09-01T00:00:00.000Z" },
          { symbol: "US30", gateStatus: "APPROVED", riskPct: "0.8", estimatedPositionSize: null, signalState: "TRADE_PLANNED", approvedAt: "2026-09-02T00:00:00.000Z" },
        ],
      })?.toString(),
    ).toBe("0.8");

    const clean = evaluateRisk({
      profile: DEFAULT_RISK_PROFILE,
      equity: "10000",
      unrealizedPnl: "10",
      trades: [],
      positions: [],
      plans: [],
      events: [],
      plan: basePlan,
      now: new Date("2026-09-02T12:00:00.000Z"),
    });
    expect(clean.allowed).toBe(true);
    expect(clean.maxLossUsd).toBe("100");
    expect(clean.positionSizeUsd).toBe("53000");
    expect(clean.minTarget).toBe("52800");
  });

  it("does not silently overwrite identity fields", () => {
    expect(
      identityChanged({
        previous: { openPrice: "100", units: "1", openedAt: "2026-09-01T00:00:00.000Z" },
        next: { openPrice: "101", units: "1", openedAt: "2026-09-01T00:00:00.000Z" },
      }),
    ).toBe(true);
    expect(minDateString({ now: new Date("2026-09-02T00:00:00.000Z"), lookbackDays: 30 })).toBe("2026-08-03");
    expect(
      identityChanged({
        previous: { openPrice: "100.0", units: "1.00", openedAt: "2026-09-01T00:00:00.000+00:00" },
        next: { openPrice: "100", units: "1", openedAt: "2026-09-01T00:00:00.000Z" },
      }),
    ).toBe(false);
    expect(tradingStatusFromFlags({ newsBlackout: false, sessionBlocked: false, cooldownActive: false })).toBe("ACTIVE");
  });
});
