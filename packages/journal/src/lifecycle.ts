import type { JournalMatchStatus, SignalDirection } from "@market-sentinel/domain";

export type JournalCloseAction = "noop" | "close-from-history" | "close-vanished";

export function decideJournalClose(args: {
  alreadyClosed: boolean;
  stillOpenOnBroker: boolean;
  hasClosedHistory: boolean;
}): JournalCloseAction {
  if (args.alreadyClosed) {
    return "noop";
  }
  if (args.stillOpenOnBroker) {
    return "noop";
  }
  if (args.hasClosedHistory) {
    return "close-from-history";
  }
  return "close-vanished";
}

export type ManualPlanDecision = "ok" | "unlink" | "not_found" | "not_approved" | "symbol_mismatch" | "in_use";

export function validateManualPlan(args: {
  tradePlanId: string | null;
  entrySymbol: string | null;
  entryDirection: SignalDirection;
  usedByOtherEntry: boolean;
  plan: { symbol: string; direction: SignalDirection; gateStatus: string } | null;
}): ManualPlanDecision {
  if (args.tradePlanId === null) {
    return "unlink";
  }
  if (!args.plan) {
    return "not_found";
  }
  if (args.usedByOtherEntry) {
    return "in_use";
  }
  if (args.plan.gateStatus !== "APPROVED") {
    return "not_approved";
  }
  if (args.entrySymbol && args.plan.symbol !== args.entrySymbol) {
    return "symbol_mismatch";
  }
  if (args.plan.direction !== args.entryDirection) {
    return "symbol_mismatch";
  }
  return "ok";
}

export function matchStatusAfterManual(args: { tradePlanId: string | null }): {
  matchStatus: JournalMatchStatus;
  tradePlanId: string | null;
  matchLocked: true;
} {
  if (args.tradePlanId) {
    return { matchStatus: "LINKED", tradePlanId: args.tradePlanId, matchLocked: true };
  }
  return { matchStatus: "UNGATED", tradePlanId: null, matchLocked: true };
}

export type ManualPlanPatchError = "invalid_plan" | "plan_in_use";

export function resolveManualPlanPatch(args: {
  tradePlanId: string | null;
  entrySymbol: string | null;
  entryDirection: SignalDirection;
  usedByOtherEntry: boolean;
  plan: { symbol: string; direction: SignalDirection; gateStatus: string } | null;
}):
  | { ok: true; match: ReturnType<typeof matchStatusAfterManual> }
  | { ok: false; error: ManualPlanPatchError } {
  const decision = validateManualPlan(args);
  if (decision === "in_use") {
    return { ok: false, error: "plan_in_use" };
  }
  if (decision === "not_found" || decision === "not_approved" || decision === "symbol_mismatch") {
    return { ok: false, error: "invalid_plan" };
  }
  return { ok: true, match: matchStatusAfterManual({ tradePlanId: args.tradePlanId }) };
}
