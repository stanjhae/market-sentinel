import { JOURNAL_DEFAULTS, type JournalMatchStatus } from "@market-sentinel/domain";

export function disciplineScore(args: {
  matchStatus: JournalMatchStatus;
  followedPlan: boolean | null;
  ruleBreaks: string[];
}): number {
  let score = JOURNAL_DEFAULTS.disciplineStart;
  if (args.matchStatus === "UNGATED") {
    score -= JOURNAL_DEFAULTS.ungatedPenalty;
  }
  if (args.followedPlan === false) {
    score -= JOURNAL_DEFAULTS.unfollowedPenalty;
  }
  score -= args.ruleBreaks.length * JOURNAL_DEFAULTS.ruleBreakPenalty;
  return Math.max(0, score);
}

export function disciplineMeetsThreshold(args: { score: number }): boolean {
  return args.score >= JOURNAL_DEFAULTS.disciplineThreshold;
}
