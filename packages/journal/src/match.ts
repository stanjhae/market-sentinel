import { JOURNAL_DEFAULTS, type JournalMatchStatus, type SignalDirection } from "@market-sentinel/domain";
import type { MatchCandidate, MatchDecision } from "./types.js";

export function matchApprovedPlan(args: {
  symbol: string;
  direction: SignalDirection;
  openedAt: Date | null;
  usedPlanIds: string[];
  plans: MatchCandidate[];
  windowMs?: number;
}): MatchDecision {
  if (!args.openedAt) {
    return { status: "UNGATED", planId: null, candidateIds: [] };
  }
  const windowMs = args.windowMs ?? JOURNAL_DEFAULTS.matchWindowMs;
  const used = new Set(args.usedPlanIds);
  const candidates = args.plans.filter((plan) => {
    if (used.has(plan.planId)) {
      return false;
    }
    if (plan.symbol !== args.symbol || plan.direction !== args.direction) {
      return false;
    }
    if (plan.approvedAt.getTime() > args.openedAt!.getTime()) {
      return false;
    }
    const delta = args.openedAt!.getTime() - plan.approvedAt.getTime();
    return delta >= 0 && delta <= windowMs;
  });
  const candidateIds = candidates.map((plan) => plan.planId);
  if (candidates.length === 1) {
    return { status: "LINKED", planId: candidates[0]!.planId, candidateIds };
  }
  if (candidates.length > 1) {
    return { status: "UNMATCHED", planId: null, candidateIds };
  }
  return { status: "UNGATED", planId: null, candidateIds };
}

export function decideInitialMatch(args: {
  historicalClosed: boolean;
  symbol: string;
  direction: SignalDirection;
  openedAt: Date | null;
  usedPlanIds: string[];
  plans: MatchCandidate[];
  windowMs?: number;
}): MatchDecision {
  if (args.historicalClosed) {
    return { status: "UNGATED", planId: null, candidateIds: [] };
  }
  return matchApprovedPlan(args);
}

export function applyManualLink(args: { tradePlanId: string | null }): {
  matchStatus: JournalMatchStatus;
  tradePlanId: string | null;
  matchLocked: true;
} {
  if (args.tradePlanId) {
    return { matchStatus: "LINKED", tradePlanId: args.tradePlanId, matchLocked: true };
  }
  return { matchStatus: "UNGATED", tradePlanId: null, matchLocked: true };
}
