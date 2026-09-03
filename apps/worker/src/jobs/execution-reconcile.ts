import { auditLogs, brokerOrders, type Database } from "@market-sentinel/db";
import {
  reconcileCloseOrder,
  reconcileOpenOrder,
  type DemoOrderReconcileClient,
  type DemoOrderReconcileResult,
} from "@market-sentinel/etoro-client";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export const STALE_EXECUTION_STATUSES = ["PENDING", "AMBIGUOUS"] as const;

export function isStaleExecutionStatus(args: { status: string }): boolean {
  return (STALE_EXECUTION_STATUSES as readonly string[]).includes(args.status);
}

export type ExecutionOrderRow = {
  id: string;
  action: string;
  status: string;
  referenceId: string;
  instrumentId: number;
  etoroOrderId: string | null;
  positionId: string | null;
};

export type ExecutionReconcileStore = {
  listStaleOrders: () => Promise<ExecutionOrderRow[]>;
  applyReconcile: (args: {
    id: string;
    status: DemoOrderReconcileResult["status"];
    etoroOrderId?: string;
    positionId?: string;
  }) => Promise<boolean>;
  writeAudit: (args: {
    eventType: string;
    requestId?: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
};

export function createDbExecutionReconcileStore(args: { db: Database }): ExecutionReconcileStore {
  return {
    listStaleOrders: async () => {
      const rows = await args.db
        .select()
        .from(brokerOrders)
        .where(inArray(brokerOrders.status, [...STALE_EXECUTION_STATUSES]));
      return rows.map((row) => ({
        id: row.id,
        action: row.action,
        status: row.status,
        referenceId: row.referenceId,
        instrumentId: row.instrumentId,
        etoroOrderId: row.etoroOrderId,
        positionId: row.positionId,
      }));
    },
    applyReconcile: async (update) => {
      const updated = await args.db
        .update(brokerOrders)
        .set({
          status: update.status,
          etoroOrderId: update.etoroOrderId ?? undefined,
          positionId: update.positionId ?? undefined,
          updatedAt: new Date(),
        })
        .where(and(eq(brokerOrders.id, update.id), inArray(brokerOrders.status, [...STALE_EXECUTION_STATUSES])))
        .returning({ id: brokerOrders.id });
      return updated.length > 0;
    },
    writeAudit: async (event) => {
      await args.db.insert(auditLogs).values({
        id: randomUUID(),
        eventType: event.eventType,
        requestId: event.requestId,
        payloadJson: event.payload,
      });
    },
  };
}

function parseEtoroOrderId(args: { value: string | null }): number | undefined {
  if (!args.value) {
    return undefined;
  }
  const parsed = Number(args.value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function auditEventType(args: { status: DemoOrderReconcileResult["status"] }): string {
  if (args.status === "FILLED") {
    return "ORDER_FILLED";
  }
  if (args.status === "REJECTED") {
    return "ORDER_REJECTED";
  }
  return "ORDER_AMBIGUOUS";
}

export async function runExecutionReconcile(args: {
  accountType: "real" | "demo";
  client: DemoOrderReconcileClient | null;
  store: ExecutionReconcileStore;
  enqueueAccountSync?: (args: { force: boolean }) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  pnlWaitMs?: number;
}): Promise<{ skipped: boolean; changed: number }> {
  if (args.accountType !== "demo" || !args.client) {
    return { skipped: true, changed: 0 };
  }
  const rows = await args.store.listStaleOrders();
  let changed = 0;
  let filled = false;
  for (const row of rows) {
    if (row.action === "close" && !row.positionId) {
      continue;
    }
    const result =
      row.action === "close" && row.positionId
        ? await reconcileCloseOrder({
            client: args.client,
            positionId: row.positionId,
            etoroOrderId: row.etoroOrderId,
            sleep: args.sleep,
            pnlWaitMs: args.pnlWaitMs ?? 0,
          })
        : await reconcileOpenOrder({
            client: args.client,
            requestId: row.referenceId,
            referenceId: row.referenceId,
            instrumentId: row.instrumentId,
            etoroOrderId: parseEtoroOrderId({ value: row.etoroOrderId }),
            sleep: args.sleep,
            pnlWaitMs: args.pnlWaitMs ?? 0,
          });
    const previousStatus = row.status;
    if (result.status === previousStatus && result.status === "AMBIGUOUS") {
      continue;
    }
    if (result.status === previousStatus && !result.etoroOrderId && !result.positionId) {
      continue;
    }
    const applied = await args.store.applyReconcile({
      id: row.id,
      status: result.status,
      etoroOrderId: result.etoroOrderId,
      positionId: result.positionId,
    });
    if (applied && result.status !== previousStatus) {
      await args.store.writeAudit({
        eventType: auditEventType({ status: result.status }),
        requestId: row.referenceId,
        payload: { orderId: row.id, status: result.status, source: "execution-reconcile" },
      });
      changed += 1;
      if (result.status === "FILLED") {
        filled = true;
      }
    }
  }
  if (filled) {
    await args.enqueueAccountSync?.({ force: true });
  }
  return { skipped: false, changed };
}
