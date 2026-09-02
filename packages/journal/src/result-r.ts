import { decimalOrNull, optionalDecimalString } from "./money.js";

export function riskDenominatorUsd(args: {
  riskAmountUsd: string | null;
  openPrice: string | null;
  stopLoss: string | null;
  units: string | null;
}): string | null {
  const planned = decimalOrNull({ value: args.riskAmountUsd });
  if (planned && !planned.isZero()) {
    return planned.abs().toString();
  }
  const open = decimalOrNull({ value: args.openPrice });
  const stop = decimalOrNull({ value: args.stopLoss });
  const units = decimalOrNull({ value: args.units });
  if (!open || !stop || !units || units.isZero() || open.eq(stop)) {
    return null;
  }
  return open.minus(stop).abs().times(units).toString();
}

export function computeResultR(args: {
  realizedPnl: string | null;
  riskAmountUsd: string | null;
  openPrice: string | null;
  stopLoss: string | null;
  units: string | null;
}): string | null {
  const pnl = decimalOrNull({ value: args.realizedPnl });
  const risk = decimalOrNull({
    value: riskDenominatorUsd({
      riskAmountUsd: args.riskAmountUsd,
      openPrice: args.openPrice,
      stopLoss: args.stopLoss,
      units: args.units,
    }),
  });
  if (!pnl || !risk || risk.isZero()) {
    return null;
  }
  return optionalDecimalString({ value: pnl.dividedBy(risk) });
}
