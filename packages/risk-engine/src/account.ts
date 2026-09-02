import { Decimal } from "decimal.js";
import { decimalOrZero, decimalString } from "./money.js";
import type { AccountTotals } from "./types.js";

export type PortfolioPositionInput = {
  positionID?: number;
  amount?: number;
  unrealizedPnL?: { pnL?: number };
};

export type PortfolioOrderInput = {
  amount?: number;
  mirrorID?: number;
  totalExternalCosts?: number;
};

export type PortfolioMirrorInput = {
  availableAmount?: number;
  closedPositionsNetProfit?: number;
  positions?: PortfolioPositionInput[];
};

export type PortfolioInput = {
  credit?: number;
  positions?: PortfolioPositionInput[];
  mirrors?: PortfolioMirrorInput[];
  orders?: PortfolioOrderInput[];
  ordersForOpen?: PortfolioOrderInput[];
};

function orderAmount(args: { order: PortfolioOrderInput }): Decimal {
  return decimalOrZero({ value: args.order.amount });
}

function isManualOpenOrder(args: { order: PortfolioOrderInput }): boolean {
  return (args.order.mirrorID ?? 0) === 0;
}

export function computeAccountTotals(args: { portfolio: PortfolioInput | undefined }): AccountTotals {
  const portfolio = args.portfolio ?? {};
  const positions = portfolio.positions ?? [];
  const mirrors = portfolio.mirrors ?? [];
  const orders = portfolio.orders ?? [];
  const ordersForOpen = portfolio.ordersForOpen ?? [];

  const reservedOpenOrders = ordersForOpen
    .filter((order) => isManualOpenOrder({ order }))
    .reduce((sum, order) => sum.plus(orderAmount({ order })), new Decimal(0));
  const reservedOrders = orders.reduce((sum, order) => sum.plus(orderAmount({ order })), new Decimal(0));
  const availableCash = decimalOrZero({ value: portfolio.credit }).minus(reservedOpenOrders).minus(reservedOrders);

  const positionAmounts = positions.reduce((sum, position) => sum.plus(decimalOrZero({ value: position.amount })), new Decimal(0));
  const mirrorPositionAmounts = mirrors.reduce((sum, mirror) => {
    return (mirror.positions ?? []).reduce((inner, position) => inner.plus(decimalOrZero({ value: position.amount })), sum);
  }, new Decimal(0));
  const mirrorResidual = mirrors.reduce((sum, mirror) => {
    return sum.plus(decimalOrZero({ value: mirror.availableAmount }).minus(decimalOrZero({ value: mirror.closedPositionsNetProfit })));
  }, new Decimal(0));
  const openOrderCosts = ordersForOpen
    .filter((order) => isManualOpenOrder({ order }))
    .reduce((sum, order) => sum.plus(decimalOrZero({ value: order.totalExternalCosts })), new Decimal(0));
  const invested = positionAmounts
    .plus(mirrorPositionAmounts)
    .plus(mirrorResidual)
    .plus(reservedOpenOrders)
    .plus(reservedOrders)
    .plus(openOrderCosts);

  const positionPnl = positions.reduce((sum, position) => sum.plus(positionUnrealized({ position })), new Decimal(0));
  const mirrorPnl = mirrors.reduce((sum, mirror) => {
    const nested = (mirror.positions ?? []).reduce((inner, position) => inner.plus(positionUnrealized({ position })), new Decimal(0));
    return sum.plus(nested).plus(decimalOrZero({ value: mirror.closedPositionsNetProfit }));
  }, new Decimal(0));
  const unrealizedPnl = positionPnl.plus(mirrorPnl);
  const equity = availableCash.plus(invested).plus(unrealizedPnl);

  return {
    availableCash: decimalString({ value: availableCash }),
    invested: decimalString({ value: invested }),
    unrealizedPnl: decimalString({ value: unrealizedPnl }),
    equity: decimalString({ value: equity }),
    cash: decimalString({ value: availableCash }),
  };
}

function positionUnrealized(args: { position: PortfolioPositionInput }): Decimal {
  return decimalOrZero({ value: args.position.unrealizedPnL?.pnL });
}

export function isUsablePnlSnapshot(args: { portfolio: PortfolioInput | undefined }): boolean {
  if (!args.portfolio) {
    return false;
  }
  return typeof args.portfolio.credit === "number" && Array.isArray(args.portfolio.positions);
}

export function displayPositions<T extends PortfolioPositionInput>(args: {
  portfolio: { positions?: T[] } | undefined;
}): T[] {
  const seen = new Set<number>();
  const positions: T[] = [];
  for (const position of args.portfolio?.positions ?? []) {
    if (typeof position.positionID !== "number" || seen.has(position.positionID)) {
      continue;
    }
    seen.add(position.positionID);
    positions.push(position);
  }
  return positions;
}
