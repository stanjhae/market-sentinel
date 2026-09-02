import type { SignalDirection } from "@market-sentinel/domain";
import { decimalOrNull, maxDecimal, optionalDecimalString } from "./money.js";
import { riskDenominatorUsd } from "./result-r.js";
import type { ExcursionState } from "./types.js";

export function excursionFromQuote(args: {
  direction: SignalDirection;
  entryPrice: string | null;
  lastPrice: string;
  units: string | null;
}): { adverseUsd: string | null; favorableUsd: string | null } {
  const entry = decimalOrNull({ value: args.entryPrice });
  const last = decimalOrNull({ value: args.lastPrice });
  const units = decimalOrNull({ value: args.units });
  if (!entry || !last || !units) {
    return { adverseUsd: null, favorableUsd: null };
  }
  const delta = last.minus(entry);
  const signed = args.direction === "SHORT" ? delta.negated() : delta;
  const favorable = signed.greaterThan(0) ? signed.times(units) : null;
  const adverse = signed.lessThan(0) ? signed.abs().times(units) : null;
  return {
    adverseUsd: optionalDecimalString({ value: adverse }),
    favorableUsd: optionalDecimalString({ value: favorable }),
  };
}

export function updateExcursion(args: {
  previous: ExcursionState;
  direction: SignalDirection;
  entryPrice: string | null;
  lastPrice: string;
  units: string | null;
  riskAmountUsd: string | null;
  stopLoss: string | null;
}): ExcursionState & { changed: boolean } {
  const next = excursionFromQuote({
    direction: args.direction,
    entryPrice: args.entryPrice,
    lastPrice: args.lastPrice,
    units: args.units,
  });
  const risk = decimalOrNull({
    value: riskDenominatorUsd({
      riskAmountUsd: args.riskAmountUsd,
      openPrice: args.entryPrice,
      stopLoss: args.stopLoss,
      units: args.units,
    }),
  });
  const maeUsd = maxDecimal({
    left: decimalOrNull({ value: args.previous.maeUsd }),
    right: decimalOrNull({ value: next.adverseUsd }),
  });
  const mfeUsd = maxDecimal({
    left: decimalOrNull({ value: args.previous.mfeUsd }),
    right: decimalOrNull({ value: next.favorableUsd }),
  });
  const maeR = maeUsd && risk && !risk.isZero() ? maeUsd.dividedBy(risk) : decimalOrNull({ value: args.previous.maeR });
  const mfeR = mfeUsd && risk && !risk.isZero() ? mfeUsd.dividedBy(risk) : decimalOrNull({ value: args.previous.mfeR });
  const state: ExcursionState = {
    maeUsd: optionalDecimalString({ value: maeUsd }),
    maeR: optionalDecimalString({ value: maeR }),
    mfeUsd: optionalDecimalString({ value: mfeUsd }),
    mfeR: optionalDecimalString({ value: mfeR }),
  };
  return {
    ...state,
    changed:
      state.maeUsd !== args.previous.maeUsd ||
      state.mfeUsd !== args.previous.mfeUsd ||
      state.maeR !== args.previous.maeR ||
      state.mfeR !== args.previous.mfeR,
  };
}
