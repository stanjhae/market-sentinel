import { describe, expect, it } from "vitest";
import type { DemoOrderLookup } from "@market-sentinel/etoro-client";
import type { EtoroPnlResponse } from "@market-sentinel/etoro-client";
import {
  isStaleExecutionStatus,
  runExecutionReconcile,
  type ExecutionOrderRow,
  type ExecutionReconcileStore,
} from "./execution-reconcile.js";

function memoryStore(args: { rows: ExecutionOrderRow[]; listAll?: boolean }): ExecutionReconcileStore & {
  audits: Array<{ eventType: string; payload: Record<string, unknown> }>;
} {
  const audits: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  return {
    audits,
    listStaleOrders: async () =>
      args.listAll ? args.rows : args.rows.filter((row) => isStaleExecutionStatus({ status: row.status })),
    applyReconcile: async (update) => {
      const row = args.rows.find((item) => item.id === update.id);
      if (!row || !isStaleExecutionStatus({ status: row.status })) {
        return false;
      }
      row.status = update.status;
      if (update.etoroOrderId) {
        row.etoroOrderId = update.etoroOrderId;
      }
      if (update.positionId) {
        row.positionId = update.positionId;
      }
      return true;
    },
    writeAudit: async (event) => {
      audits.push({ eventType: event.eventType, payload: event.payload });
    },
  };
}

describe("runExecutionReconcile", () => {
  it("skips unless the account is Demo and a client exists", async () => {
    const store = memoryStore({
      rows: [
        {
          id: "o1",
          action: "open",
          status: "AMBIGUOUS",
          referenceId: "11111111-1111-4111-8111-111111111111",
          instrumentId: 27,
          etoroOrderId: "4",
          positionId: null,
        },
      ],
    });
    const skippedReal = await runExecutionReconcile({
      accountType: "real",
      client: {
        lookupOrder: async () => {
          throw new Error("must not lookup on real");
        },
        getDemoPnl: async () => ({ clientPortfolio: { positions: [] } }),
        getCloseOrder: async () => ({ orderForClose: {} }),
      },
      store,
    });
    expect(skippedReal).toEqual({ skipped: true, changed: 0 });
    const skippedMissing = await runExecutionReconcile({
      accountType: "demo",
      client: null,
      store,
    });
    expect(skippedMissing).toEqual({ skipped: true, changed: 0 });
  });

  it("marks AMBIGUOUS filled when the same orderId is in Demo PnL and never POSTs", async () => {
    const rows: ExecutionOrderRow[] = [
      {
        id: "o1",
        action: "open",
        status: "AMBIGUOUS",
        referenceId: "11111111-1111-4111-8111-111111111111",
        instrumentId: 27,
        etoroOrderId: "4",
        positionId: null,
      },
    ];
    const store = memoryStore({ rows });
    let creates = 0;
    let closes = 0;
    const client = {
      createOpenOrder: async () => {
        creates += 1;
        throw new Error("must not POST");
      },
      closePosition: async () => {
        closes += 1;
        throw new Error("must not POST");
      },
      lookupOrder: async (): Promise<DemoOrderLookup> => {
        throw new Error("lookup missed");
      },
      getDemoPnl: async (): Promise<EtoroPnlResponse> => ({
        clientPortfolio: { positions: [{ positionID: 12, instrumentID: 27, orderID: 4 }] },
      }),
      getCloseOrder: async () => ({ orderForClose: {} }),
    };
    let forced = 0;
    const first = await runExecutionReconcile({
      accountType: "demo",
      client,
      store,
      enqueueAccountSync: async () => {
        forced += 1;
      },
    });
    expect(first).toEqual({ skipped: false, changed: 1 });
    expect(rows[0]?.status).toBe("FILLED");
    expect(rows[0]?.positionId).toBe("12");
    expect(store.audits[0]?.eventType).toBe("ORDER_FILLED");
    expect(forced).toBe(1);
    expect(creates).toBe(0);
    expect(closes).toBe(0);

    const second = await runExecutionReconcile({
      accountType: "demo",
      client,
      store,
      enqueueAccountSync: async () => {
        forced += 1;
      },
    });
    expect(second).toEqual({ skipped: false, changed: 0 });
    expect(forced).toBe(1);
    expect(creates).toBe(0);
  });

  it("stays AMBIGUOUS when PnL only has another position on the same instrument", async () => {
    const rows: ExecutionOrderRow[] = [
      {
        id: "o1",
        action: "open",
        status: "AMBIGUOUS",
        referenceId: "11111111-1111-4111-8111-111111111111",
        instrumentId: 27,
        etoroOrderId: "99",
        positionId: null,
      },
    ];
    const store = memoryStore({ rows });
    await runExecutionReconcile({
      accountType: "demo",
      client: {
        lookupOrder: async () => {
          throw new Error("lookup missed");
        },
        getDemoPnl: async (): Promise<EtoroPnlResponse> => ({
          clientPortfolio: { positions: [{ positionID: 12, instrumentID: 27, orderID: 4 }] },
        }),
        getCloseOrder: async () => ({ orderForClose: {} }),
      },
      store,
    });
    expect(rows[0]?.status).toBe("AMBIGUOUS");
    expect(store.audits).toEqual([]);
  });

  it("does not downgrade a row that confirm already marked FILLED", async () => {
    const rows: ExecutionOrderRow[] = [
      {
        id: "o1",
        action: "open",
        status: "FILLED",
        referenceId: "11111111-1111-4111-8111-111111111111",
        instrumentId: 27,
        etoroOrderId: "4",
        positionId: "12",
      },
    ];
    const store = memoryStore({ rows, listAll: true });
    const result = await runExecutionReconcile({
      accountType: "demo",
      client: {
        lookupOrder: async () => {
          throw new Error("lookup missed");
        },
        getDemoPnl: async (): Promise<EtoroPnlResponse> => ({ clientPortfolio: { positions: [] } }),
        getCloseOrder: async () => ({ orderForClose: {} }),
      },
      store,
    });
    expect(result).toEqual({ skipped: false, changed: 0 });
    expect(rows[0]?.status).toBe("FILLED");
    expect(store.audits).toEqual([]);
  });

  it("marks a close FILLED when Demo PnL no longer lists the position", async () => {
    const rows: ExecutionOrderRow[] = [
      {
        id: "c1",
        action: "close",
        status: "AMBIGUOUS",
        referenceId: "22222222-2222-4222-8222-222222222222",
        instrumentId: 27,
        etoroOrderId: "7",
        positionId: "12",
      },
    ];
    const store = memoryStore({ rows });
    let creates = 0;
    let closes = 0;
    const client = {
      createOpenOrder: async () => {
        creates += 1;
        throw new Error("must not POST");
      },
      closePosition: async () => {
        closes += 1;
        throw new Error("must not POST");
      },
      lookupOrder: async () => {
        throw new Error("open lookup must not run for close");
      },
      getCloseOrder: async () => ({ orderForClose: { statusID: 3, orderID: 7 } }),
      getDemoPnl: async (): Promise<EtoroPnlResponse> => ({ clientPortfolio: { positions: [] } }),
    };
    const result = await runExecutionReconcile({
      accountType: "demo",
      client,
      store,
    });
    expect(result).toEqual({ skipped: false, changed: 1 });
    expect(rows[0]?.status).toBe("FILLED");
    expect(store.audits[0]?.eventType).toBe("ORDER_FILLED");
    expect(creates).toBe(0);
    expect(closes).toBe(0);
  });

  it("keeps a close AMBIGUOUS when the position is still open and skips close without positionId", async () => {
    const rows: ExecutionOrderRow[] = [
      {
        id: "c1",
        action: "close",
        status: "AMBIGUOUS",
        referenceId: "22222222-2222-4222-8222-222222222222",
        instrumentId: 27,
        etoroOrderId: "7",
        positionId: "12",
      },
      {
        id: "c2",
        action: "close",
        status: "PENDING",
        referenceId: "33333333-3333-4333-8333-333333333333",
        instrumentId: 27,
        etoroOrderId: "8",
        positionId: null,
      },
    ];
    const store = memoryStore({ rows });
    let lookups = 0;
    await runExecutionReconcile({
      accountType: "demo",
      client: {
        lookupOrder: async () => {
          lookups += 1;
          throw new Error("open lookup must not run for close");
        },
        getCloseOrder: async () => ({ orderForClose: { statusID: 2, orderID: 7 } }),
        getDemoPnl: async (): Promise<EtoroPnlResponse> => ({
          clientPortfolio: { positions: [{ positionID: 12, instrumentID: 27 }] },
        }),
      },
      store,
    });
    expect(rows[0]?.status).toBe("AMBIGUOUS");
    expect(rows[1]?.status).toBe("PENDING");
    expect(lookups).toBe(0);
    expect(store.audits).toEqual([]);
  });
});

