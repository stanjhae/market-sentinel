import { TIMEFRAME_MS, type SignalDirection } from "@market-sentinel/domain";
import { decimalOrNull, optionalDecimalString } from "@market-sentinel/journal";
import type { SignalRecord } from "@market-sentinel/strategies";
import { Decimal } from "decimal.js";
import type { BacktestCosts, InputCandle, SimulatedTrade } from "./types.js";

function adverseEntry(args: { direction: SignalDirection; open: Decimal; costs: BacktestCosts }): Decimal {
  const slip = decimalOrNull({ value: args.costs.slippage }) ?? new Decimal(0);
  const spread = decimalOrNull({ value: args.costs.spread }) ?? new Decimal(0);
  const bump = slip.plus(spread);
  return args.direction === "SHORT" ? args.open.minus(bump) : args.open.plus(bump);
}

function touchedStop(args: { direction: SignalDirection; bar: InputCandle; stop: Decimal }): boolean {
  if (args.direction === "SHORT") {
    return new Decimal(args.bar.high).gte(args.stop);
  }
  return new Decimal(args.bar.low).lte(args.stop);
}

function touchedTarget(args: { direction: SignalDirection; bar: InputCandle; target: Decimal }): boolean {
  if (args.direction === "SHORT") {
    return new Decimal(args.bar.low).lte(args.target);
  }
  return new Decimal(args.bar.high).gte(args.target);
}

function gappedThroughStop(args: { direction: SignalDirection; open: Decimal; stop: Decimal }): boolean {
  if (args.direction === "SHORT") {
    return args.open.gte(args.stop);
  }
  return args.open.lte(args.stop);
}

function signedPnl(args: { direction: SignalDirection; entry: Decimal; exit: Decimal; units: Decimal }): Decimal {
  const delta = args.direction === "SHORT" ? args.entry.minus(args.exit) : args.exit.minus(args.entry);
  return delta.times(args.units);
}

function feeOf(args: { price: Decimal; units: Decimal; feeBps: Decimal }): Decimal {
  return args.price.times(args.units).times(args.feeBps).dividedBy(10_000);
}

function updateExcursion(args: {
  direction: SignalDirection;
  entry: Decimal;
  units: Decimal;
  bar: InputCandle;
  mae: Decimal;
  mfe: Decimal;
}): { mae: Decimal; mfe: Decimal } {
  const adverse = args.direction === "SHORT" ? new Decimal(args.bar.high).minus(args.entry) : args.entry.minus(new Decimal(args.bar.low));
  const favorable = args.direction === "SHORT" ? args.entry.minus(new Decimal(args.bar.low)) : new Decimal(args.bar.high).minus(args.entry);
  return {
    mae: Decimal.max(args.mae, Decimal.max(adverse, 0).times(args.units)),
    mfe: Decimal.max(args.mfe, Decimal.max(favorable, 0).times(args.units)),
  };
}

function diedBeforeEntry(args: { signal: SignalRecord; entryOpen: Date }): boolean {
  const diedAt = [args.signal.invalidatedAt, args.signal.expiredAt, args.signal.dismissedAt].filter(
    (value): value is Date => value instanceof Date,
  );
  return diedAt.some((at) => at.getTime() < args.entryOpen.getTime());
}

export function simulateFills(args: {
  signals: SignalRecord[];
  bars15m: InputCandle[];
  costs: BacktestCosts;
  untilIndex?: number;
  forceEntryIndex?: number;
}): SimulatedTrade[] {
  const lastIndex = args.untilIndex ?? args.bars15m.length - 1;
  const units = decimalOrNull({ value: args.costs.units }) ?? new Decimal(1);
  const feeBps = decimalOrNull({ value: args.costs.feeBps }) ?? new Decimal(0);
  const trades: SimulatedTrade[] = [];
  for (const signal of args.signals) {
    if (signal.direction === "NEUTRAL" || !signal.invalidationPrice) {
      continue;
    }
    if (args.forceEntryIndex === undefined && !signal.confirmedAt) {
      continue;
    }
    const confirmIndex =
      args.forceEntryIndex === undefined
        ? args.bars15m.findIndex((bar) => bar.openTimeUtc.getTime() === signal.confirmedAt!.getTime())
        : args.forceEntryIndex - 1;
    if (args.forceEntryIndex === undefined && confirmIndex < 0) {
      continue;
    }
    const entryIndex = args.forceEntryIndex ?? confirmIndex + 1;
    const base = {
      id: `fill-${signal.id}`,
      signalId: signal.id,
      strategyKey: signal.strategyKey,
      strategyVersion: signal.strategyVersion,
      direction: signal.direction,
      stopLoss: signal.invalidationPrice,
      target1: signal.target1,
      entryBarIndex: null,
      exitBarIndex: null,
      openedAt: null,
      closedAt: null,
      entryPrice: null,
      exitPrice: null,
      realizedPnl: null,
      fees: null,
      resultR: null,
      maeUsd: null,
      mfeUsd: null,
      exitReason: null,
      unfillableReason: null as "gap" | null,
    };
    if (entryIndex > lastIndex || !args.bars15m[entryIndex]) {
      trades.push({ ...base, status: "open" });
      continue;
    }
    const entryBar = args.bars15m[entryIndex]!;
    if (diedBeforeEntry({ signal, entryOpen: entryBar.openTimeUtc })) {
      continue;
    }
    const stop = decimalOrNull({ value: signal.invalidationPrice });
    const open = decimalOrNull({ value: entryBar.open });
    if (!stop || !open) {
      continue;
    }
    if (gappedThroughStop({ direction: signal.direction, open, stop })) {
      trades.push({
        ...base,
        status: "unfillable",
        unfillableReason: "gap",
        openedAt: entryBar.openTimeUtc,
        entryBarIndex: entryIndex,
      });
      continue;
    }
    const entry = adverseEntry({ direction: signal.direction, open, costs: args.costs });
    let mae = new Decimal(0);
    let mfe = new Decimal(0);
    let exitPrice: Decimal | null = null;
    let exitIndex: number | null = null;
    let exitReason: string | null = null;
    const target = signal.target1 ? decimalOrNull({ value: signal.target1 }) : null;
    for (let index = entryIndex; index <= lastIndex; index += 1) {
      const bar = args.bars15m[index]!;
      const excursion = updateExcursion({ direction: signal.direction, entry, units, bar, mae, mfe });
      mae = excursion.mae;
      mfe = excursion.mfe;
      const stopHit = touchedStop({ direction: signal.direction, bar, stop });
      const targetHit = target ? touchedTarget({ direction: signal.direction, bar, target }) : false;
      if (stopHit && targetHit) {
        exitPrice = stop;
        exitIndex = index;
        exitReason = "stop";
        break;
      }
      if (stopHit) {
        exitPrice = stop;
        exitIndex = index;
        exitReason = "stop";
        break;
      }
      if (targetHit && target) {
        exitPrice = target;
        exitIndex = index;
        exitReason = "target1";
        break;
      }
    }
    if (!exitPrice || exitIndex === null) {
      trades.push({
        ...base,
        status: "open",
        openedAt: entryBar.openTimeUtc,
        entryPrice: entry.toString(),
        entryBarIndex: entryIndex,
        maeUsd: optionalDecimalString({ value: mae }),
        mfeUsd: optionalDecimalString({ value: mfe }),
      });
      continue;
    }
    const exitBar = args.bars15m[exitIndex]!;
    const fees = feeOf({ price: exitPrice, units, feeBps });
    const pnl = signedPnl({ direction: signal.direction, entry, exit: exitPrice, units }).minus(fees);
    const risk = entry.minus(stop).abs().times(units);
    trades.push({
      ...base,
      status: "closed",
      openedAt: entryBar.openTimeUtc,
      closedAt: exitBar.openTimeUtc,
      entryPrice: entry.toString(),
      exitPrice: exitPrice.toString(),
      entryBarIndex: entryIndex,
      exitBarIndex: exitIndex,
      realizedPnl: pnl.toString(),
      fees: fees.toString(),
      resultR: risk.isZero() ? null : pnl.dividedBy(risk).toString(),
      maeUsd: optionalDecimalString({ value: mae }),
      mfeUsd: optionalDecimalString({ value: mfe }),
      exitReason,
    });
  }
  return trades;
}

export function paperFillAt(args: {
  direction: SignalDirection;
  stopLoss: string;
  target1: string;
  bars15m: InputCandle[];
  index: number;
  costs: BacktestCosts;
  id: string;
}): SimulatedTrade {
  const entryIndex = Math.min(Math.max(0, args.index), Math.max(0, args.bars15m.length - 1));
  const entryBar = args.bars15m[entryIndex];
  const confirmedAt = entryBar
    ? new Date(entryBar.openTimeUtc.getTime() - TIMEFRAME_MS["15m"])
    : new Date(0);
  const stub = {
    id: args.id,
    instrumentId: "paper",
    symbol: entryBar?.symbol ?? "US30",
    strategyKey: "breakdown-retest" as const,
    strategyVersion: "paper",
    direction: args.direction,
    state: "CONFIRMED" as const,
    triggerTimeframe: "15m" as const,
    detectedAt: entryBar?.openTimeUtc ?? new Date(0),
    watchingAt: null,
    confirmedAt,
    tradePlannedAt: null,
    enteredAt: null,
    closedAt: null,
    invalidatedAt: null,
    expiredAt: null,
    dismissedAt: null,
    score: 0,
    confidenceLabel: "Ignore" as const,
    entryZoneLow: null,
    entryZoneHigh: null,
    invalidationPrice: args.stopLoss,
    target1: args.target1,
    target2: null,
    target3: null,
    riskRewardToT1: null,
    riskRewardToT2: null,
    lastEvaluatedOpenTimeUtc: entryBar?.openTimeUtc ?? new Date(0),
    evidenceJson: {},
    snapshotJson: {},
  };
  return (
    simulateFills({
      signals: [stub],
      bars15m: args.bars15m,
      costs: args.costs,
      untilIndex: entryIndex,
      forceEntryIndex: entryIndex,
    })[0] ?? {
      id: args.id,
      signalId: args.id,
      strategyKey: "breakdown-retest",
      strategyVersion: "paper",
      direction: args.direction,
      status: "open",
      unfillableReason: null,
      openedAt: null,
      closedAt: null,
      entryPrice: null,
      exitPrice: null,
      realizedPnl: null,
      fees: null,
      resultR: null,
      maeUsd: null,
      mfeUsd: null,
      exitReason: null,
      stopLoss: args.stopLoss,
      target1: args.target1,
      entryBarIndex: null,
      exitBarIndex: null,
    }
  );
}
