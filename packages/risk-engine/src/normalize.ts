import type { AccountType, SignalDirection } from "@market-sentinel/domain";
import { optionalDecimalString } from "./money.js";
import type { BrokerPosition, BrokerTrade } from "./types.js";

export type PnlPositionWire = {
  positionID?: number;
  instrumentID?: number;
  isBuy?: boolean;
  openDateTime?: string;
  openRate?: number;
  units?: number;
  amount?: number;
  leverage?: number;
  stopLossRate?: number;
  takeProfitRate?: number;
  totalFees?: number;
  mirrorID?: number;
  unrealizedPnL?: { pnL?: number };
};

export type HistoryItemWire = {
  positionId?: number;
  instrumentId?: number;
  isBuy?: boolean;
  leverage?: number;
  openRate?: number;
  closeRate?: number;
  openTimestamp?: string;
  closeTimestamp?: string;
  netProfit?: number;
  investment?: number;
  initialInvestment?: number;
  fees?: number;
  units?: number;
  stopLossRate?: number;
  takeProfitRate?: number;
};

export function normalizePnlPosition(args: {
  position: PnlPositionWire;
  symbol: string | null;
}): BrokerPosition | null {
  if (typeof args.position.positionID !== "number" || typeof args.position.instrumentID !== "number") {
    return null;
  }
  return {
    etoroPositionId: String(args.position.positionID),
    instrumentId: args.position.instrumentID,
    symbol: args.symbol,
    direction: args.position.isBuy === false ? "SHORT" : "LONG",
    openedAt: args.position.openDateTime ?? null,
    openPrice: optionalDecimalString({ value: args.position.openRate }),
    units: optionalDecimalString({ value: args.position.units }),
    investedAmount: optionalDecimalString({ value: args.position.amount }),
    leverage: optionalDecimalString({ value: args.position.leverage }),
    stopLoss: optionalDecimalString({ value: args.position.stopLossRate }),
    takeProfit: optionalDecimalString({ value: args.position.takeProfitRate }),
    unrealizedPnl: optionalDecimalString({ value: args.position.unrealizedPnL?.pnL }),
    fees: optionalDecimalString({ value: args.position.totalFees }),
    mirrorId: args.position.mirrorID ?? 0,
  };
}

export function normalizeHistoryItem(args: {
  item: HistoryItemWire;
  symbol: string | null;
  sourceAccount: AccountType;
}): BrokerTrade | null {
  if (typeof args.item.positionId !== "number" || typeof args.item.instrumentId !== "number") {
    return null;
  }
  const direction: SignalDirection = args.item.isBuy === false ? "SHORT" : "LONG";
  return {
    etoroPositionId: String(args.item.positionId),
    instrumentId: args.item.instrumentId,
    symbol: args.symbol,
    direction,
    openedAt: args.item.openTimestamp ?? null,
    closedAt: args.item.closeTimestamp ?? null,
    openPrice: optionalDecimalString({ value: args.item.openRate }),
    closePrice: optionalDecimalString({ value: args.item.closeRate }),
    units: optionalDecimalString({ value: args.item.units }),
    investedAmount: optionalDecimalString({ value: args.item.investment ?? args.item.initialInvestment }),
    leverage: optionalDecimalString({ value: args.item.leverage }),
    stopLoss: optionalDecimalString({ value: args.item.stopLossRate }),
    takeProfit: optionalDecimalString({ value: args.item.takeProfitRate }),
    realizedPnl: optionalDecimalString({ value: args.item.netProfit }),
    fees: optionalDecimalString({ value: args.item.fees }),
    sourceAccount: args.sourceAccount,
  };
}
