export { STRATEGY_DEFAULTS, STRATEGY_VERSIONS } from "./defaults.js";
export { breakdownRetestStrategy } from "./breakdown-retest.js";
export { sweepReclaimStrategy } from "./sweep-reclaim.js";
export { trendPullbackStrategy } from "./trend-pullback.js";
export { doNotChaseActive, doNotChaseStrategy } from "./do-not-chase.js";
export { evaluateAllStrategies, STRATEGIES } from "./evaluate.js";
export { scoreOpportunity } from "./score.js";
export { applySignalTransition, canTransition, createDetectedSignal, createPlanStub, dismissSignal, streamEvaluationFrozen } from "./machine.js";
export {
  bestOpenTradeSetup,
  emptyEvaluation,
  isTradeSetupStrategy,
  nextTarget,
  parameterSnapshot,
  pickPreferredEvaluation,
  planLevels,
  rewardRisk,
} from "./helpers.js";
export type {
  OpportunityScore,
  ScoreFactors,
  SignalRecord,
  Strategy,
  StrategyEvaluation,
  StrategyIndicators,
  StrategySnapshot,
  TransitionEvent,
  TransitionResult,
} from "./types.js";
