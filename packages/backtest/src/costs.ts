import { BACKTEST_DEFAULTS } from "@market-sentinel/domain";
import type { BacktestCosts } from "./types.js";

export function resolveCosts(args: { costs?: Partial<BacktestCosts> }): BacktestCosts {
  return {
    slippage: args.costs?.slippage ?? BACKTEST_DEFAULTS.slippage,
    spread: args.costs?.spread ?? BACKTEST_DEFAULTS.spread,
    feeBps: args.costs?.feeBps ?? BACKTEST_DEFAULTS.feeBps,
    units: args.costs?.units ?? BACKTEST_DEFAULTS.units,
  };
}
