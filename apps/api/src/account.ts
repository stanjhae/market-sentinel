import type { AccountResponse, HistoryResponse, PositionsResponse } from "@market-sentinel/contracts";
import { REDIS_KEYS } from "@market-sentinel/contracts";
import { brokerPositions, brokerTrades, type Database } from "@market-sentinel/db";
import { desc } from "drizzle-orm";
import { Redis } from "ioredis";
import { emptyAccount } from "./markets.js";

export function emptyPositions(): PositionsResponse {
  return { available: false, positions: [] };
}

export function emptyHistory(): HistoryResponse {
  return { available: false, historyUnavailable: false, trades: [] };
}

export async function readAccountSnapshot(args: { redis: Redis }): Promise<AccountResponse> {
  const raw = await args.redis.get(REDIS_KEYS.account);
  if (!raw) {
    return emptyAccount();
  }
  return { ...emptyAccount(), ...(JSON.parse(raw) as Partial<AccountResponse>), available: true };
}

export async function readPositions(args: { db: Database }): Promise<PositionsResponse> {
  const rows = await args.db.select().from(brokerPositions);
  return {
    available: true,
    positions: rows.map((row) => ({
      etoroPositionId: row.etoroPositionId,
      instrumentId: row.instrumentId,
      symbol: row.symbol,
      direction: row.direction as PositionsResponse["positions"][number]["direction"],
      openedAt: row.openedAt?.toISOString() ?? null,
      openPrice: row.openPrice,
      units: row.units,
      investedAmount: row.investedAmount,
      leverage: row.leverage,
      stopLoss: row.stopLoss,
      takeProfit: row.takeProfit,
      unrealizedPnl: row.unrealizedPnl,
      fees: row.fees,
    })),
  };
}

export async function readHistory(args: { db: Database; historyUnavailable: boolean }): Promise<HistoryResponse> {
  const rows = await args.db.select().from(brokerTrades).orderBy(desc(brokerTrades.closedAt));
  return {
    available: true,
    historyUnavailable: args.historyUnavailable,
    trades: rows.map((row) => ({
      etoroPositionId: row.etoroPositionId,
      instrumentId: row.instrumentId,
      symbol: row.symbol,
      direction: row.direction as HistoryResponse["trades"][number]["direction"],
      openedAt: row.openedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      openPrice: row.openPrice,
      closePrice: row.closePrice,
      units: row.units,
      investedAmount: row.investedAmount,
      realizedPnl: row.realizedPnl,
      fees: row.fees,
      sourceAccount: row.sourceAccount as HistoryResponse["trades"][number]["sourceAccount"],
    })),
  };
}
