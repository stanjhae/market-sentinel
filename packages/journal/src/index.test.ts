import { JOURNAL_DEFAULTS } from "@market-sentinel/domain";
import { describe, expect, it } from "vitest";
import { analyticsFromTrades } from "./analytics.js";
import { disciplineScore } from "./discipline.js";
import { updateExcursion } from "./excursion.js";
import { decideJournalClose, resolveManualPlanPatch, validateManualPlan } from "./lifecycle.js";
import { decideInitialMatch, matchApprovedPlan } from "./match.js";
import { computeResultR } from "./result-r.js";
import type { ClosedJournalTrade, MatchCandidate } from "./types.js";

function plan(args: { id: string; approvedAt: string; direction?: "LONG" | "SHORT" }): MatchCandidate {
  return {
    planId: args.id,
    symbol: "US30",
    direction: args.direction ?? "LONG",
    approvedAt: new Date(args.approvedAt),
  };
}

function trade(args: Omit<Partial<ClosedJournalTrade>, "closedAt" | "openedAt"> & { closedAt: string; openedAt?: string; pnl: string }): ClosedJournalTrade {
  return {
    closedAt: new Date(args.closedAt),
    openedAt: args.openedAt ? new Date(args.openedAt) : new Date(args.closedAt),
    symbol: args.symbol ?? "US30",
    direction: args.direction ?? "LONG",
    setupKey: args.setupKey ?? "breakdown-retest",
    realizedPnl: args.pnl,
    fees: args.fees ?? "1",
    resultR: args.resultR ?? args.pnl,
    maeUsd: args.maeUsd ?? "2",
    mfeUsd: args.mfeUsd ?? "4",
    matchStatus: args.matchStatus ?? "LINKED",
    followedPlan: args.followedPlan ?? true,
    ruleBreaks: args.ruleBreaks ?? [],
    alignedWithTrend: args.alignedWithTrend ?? true,
  };
}

describe("matching", () => {
  it("links a unique plan inside the 4h window and rejects later opens", () => {
    const openedAt = new Date("2026-09-01T12:00:00.000Z");
    const unique = matchApprovedPlan({
      symbol: "US30",
      direction: "LONG",
      openedAt,
      usedPlanIds: [],
      plans: [plan({ id: "p1", approvedAt: "2026-09-01T10:00:00.000Z" })],
    });
    expect(unique).toEqual({ status: "LINKED", planId: "p1", candidateIds: ["p1"] });
    const late = matchApprovedPlan({
      symbol: "US30",
      direction: "LONG",
      openedAt: new Date("2026-09-01T16:00:00.001Z"),
      usedPlanIds: [],
      plans: [plan({ id: "p1", approvedAt: "2026-09-01T12:00:00.000Z" })],
    });
    expect(late.status).toBe("UNGATED");
    const exact = matchApprovedPlan({
      symbol: "US30",
      direction: "LONG",
      openedAt: new Date(openedAt.getTime() + JOURNAL_DEFAULTS.matchWindowMs),
      usedPlanIds: [],
      plans: [plan({ id: "p1", approvedAt: openedAt.toISOString() })],
    });
    expect(exact.status).toBe("LINKED");
  });

  it("marks ambiguous plans unmatched and historical closes ungated", () => {
    const openedAt = new Date("2026-09-01T12:00:00.000Z");
    const ambiguous = matchApprovedPlan({
      symbol: "US30",
      direction: "LONG",
      openedAt,
      usedPlanIds: [],
      plans: [
        plan({ id: "p1", approvedAt: "2026-09-01T11:00:00.000Z" }),
        plan({ id: "p2", approvedAt: "2026-09-01T11:30:00.000Z" }),
      ],
    });
    expect(ambiguous.status).toBe("UNMATCHED");
    expect(ambiguous.candidateIds).toEqual(["p1", "p2"]);
    expect(
      decideInitialMatch({
        historicalClosed: true,
        symbol: "US30",
        direction: "LONG",
        openedAt,
        usedPlanIds: [],
        plans: [plan({ id: "p1", approvedAt: "2026-09-01T11:00:00.000Z" })],
      }).status,
    ).toBe("UNGATED");
  });
});

describe("excursions and resultR", () => {
  it("tracks MAE/MFE maxima across quotes and restart state", () => {
    const first = updateExcursion({
      previous: { maeUsd: null, maeR: null, mfeUsd: null, mfeR: null },
      direction: "LONG",
      entryPrice: "100",
      lastPrice: "99",
      units: "2",
      riskAmountUsd: "10",
      stopLoss: "95",
    });
    expect(first.maeUsd).toBe("2");
    expect(first.maeR).toBe("0.2");
    const recovered = updateExcursion({
      previous: first,
      direction: "LONG",
      entryPrice: "100",
      lastPrice: "103",
      units: "2",
      riskAmountUsd: "10",
      stopLoss: "95",
    });
    expect(recovered.maeUsd).toBe("2");
    expect(recovered.mfeUsd).toBe("6");
    expect(recovered.mfeR).toBe("0.6");
    const short = updateExcursion({
      previous: { maeUsd: null, maeR: null, mfeUsd: null, mfeR: null },
      direction: "SHORT",
      entryPrice: "100",
      lastPrice: "102",
      units: "1",
      riskAmountUsd: null,
      stopLoss: "104",
    });
    expect(short.maeUsd).toBe("2");
  });

  it("uses plan risk then stop distance for resultR", () => {
    expect(
      computeResultR({
        realizedPnl: "20",
        riskAmountUsd: "10",
        openPrice: "100",
        stopLoss: "90",
        units: "1",
      }),
    ).toBe("2");
    expect(
      computeResultR({
        realizedPnl: "-8",
        riskAmountUsd: null,
        openPrice: "100",
        stopLoss: "96",
        units: "2",
      }),
    ).toBe("-1");
  });
});

describe("discipline and analytics", () => {
  it("deducts ungated, unfollowed, and rule-break points", () => {
    expect(disciplineScore({ matchStatus: "LINKED", followedPlan: true, ruleBreaks: [] })).toBe(100);
    expect(disciplineScore({ matchStatus: "UNGATED", followedPlan: false, ruleBreaks: ["chase"] })).toBe(40);
  });

  it("returns an empty envelope instead of a zeroed track record", () => {
    expect(analyticsFromTrades({ trades: [] })).toEqual({
      empty: true,
      summary: null,
      setups: [],
      instruments: [],
      psychology: null,
    });
  });

  it("excludes null realizedPnl from win rate and net P/L", () => {
    const result = analyticsFromTrades({
      trades: [
        trade({ closedAt: "2026-09-01T10:00:00.000Z", pnl: "10", resultR: "2" }),
        {
          ...trade({ closedAt: "2026-09-01T11:00:00.000Z", pnl: "0", resultR: null }),
          realizedPnl: null,
        },
      ],
    });
    expect(result.summary?.closedCount).toBe(2);
    expect(result.summary?.netPnl).toBe("10");
    expect(result.summary?.winRate).toBe("1");
  });

  it("compares gated vs ungated and expectancy in R", () => {
    const result = analyticsFromTrades({
      trades: [
        trade({ closedAt: "2026-09-01T10:00:00.000Z", pnl: "10", resultR: "2", matchStatus: "LINKED" }),
        trade({
          closedAt: "2026-09-01T11:00:00.000Z",
          pnl: "-5",
          resultR: "-1",
          matchStatus: "UNGATED",
          followedPlan: false,
          alignedWithTrend: false,
          setupKey: "none",
        }),
      ],
    });
    expect(result.empty).toBe(false);
    expect(result.summary?.netPnl).toBe("5");
    expect(result.summary?.gated.count).toBe(1);
    expect(result.summary?.ungated.count).toBe(1);
    expect(result.summary?.expectancyR).toBe("0.5");
    expect(result.psychology?.followed.count).toBe(1);
    expect(result.psychology?.broken.count).toBe(1);
  });
});

describe("journal lifecycle", () => {
  it("keeps a position open when it is still on the broker even if history exists", () => {
    expect(
      decideJournalClose({ alreadyClosed: false, stillOpenOnBroker: true, hasClosedHistory: true }),
    ).toBe("noop");
    expect(
      decideJournalClose({ alreadyClosed: false, stillOpenOnBroker: false, hasClosedHistory: true }),
    ).toBe("close-from-history");
    expect(
      decideJournalClose({ alreadyClosed: false, stillOpenOnBroker: false, hasClosedHistory: false }),
    ).toBe("close-vanished");
    expect(
      decideJournalClose({ alreadyClosed: true, stillOpenOnBroker: false, hasClosedHistory: false }),
    ).toBe("noop");
  });

  it("rejects missing, unapproved, mismatched, and in-use manual plan links", () => {
    const base = {
      tradePlanId: "plan-1",
      entrySymbol: "US30",
      entryDirection: "LONG" as const,
      usedByOtherEntry: false,
      plan: { symbol: "US30", direction: "LONG" as const, gateStatus: "APPROVED" },
    };
    expect(validateManualPlan({ ...base, plan: null })).toBe("not_found");
    expect(validateManualPlan({ ...base, plan: { ...base.plan, gateStatus: "BLOCKED" } })).toBe("not_approved");
    expect(validateManualPlan({ ...base, plan: { ...base.plan, symbol: "GOLD" } })).toBe("symbol_mismatch");
    expect(validateManualPlan({ ...base, usedByOtherEntry: true })).toBe("in_use");
    expect(resolveManualPlanPatch({ ...base, plan: null })).toEqual({ ok: false, error: "invalid_plan" });
    expect(resolveManualPlanPatch({ ...base, usedByOtherEntry: true })).toEqual({ ok: false, error: "plan_in_use" });
    expect(resolveManualPlanPatch(base)).toEqual({
      ok: true,
      match: { matchStatus: "LINKED", tradePlanId: "plan-1", matchLocked: true },
    });
    expect(resolveManualPlanPatch({ ...base, tradePlanId: null, plan: null })).toEqual({
      ok: true,
      match: { matchStatus: "UNGATED", tradePlanId: null, matchLocked: true },
    });
  });
});
