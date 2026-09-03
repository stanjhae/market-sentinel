import { describe, expect, it } from "vitest";
import type { InstrumentRef } from "../candle-store.js";
import { runCandleReconcile } from "./candle-reconcile.js";

const us30: InstrumentRef = { id: "inst-1", symbol: "US30", etoroInstrumentId: 27 };

describe("runCandleReconcile", () => {
  it("calls reconcile once per instrument and does not invent a second revision on duplicate delivery", async () => {
    const revisionsBySymbol = new Map<string, number>([["US30", 0]]);
    const reconcileCalls: string[] = [];
    const evaluateCalls: string[] = [];
    const revised: number[] = [];
    const reconcileOne = async (args: { instrument: InstrumentRef }) => {
      reconcileCalls.push(args.instrument.symbol);
      const current = revisionsBySymbol.get(args.instrument.symbol) ?? 0;
      if (current === 0) {
        revisionsBySymbol.set(args.instrument.symbol, 1);
        return 1;
      }
      return 0;
    };
    const evaluateSignals = async (args: { instrument: InstrumentRef }) => {
      evaluateCalls.push(args.instrument.symbol);
    };
    await runCandleReconcile({
      instruments: [us30],
      reconcileOne,
      evaluateSignals,
      onRevised: ({ revisions }) => {
        revised.push(revisions);
      },
    });
    await runCandleReconcile({
      instruments: [us30],
      reconcileOne,
      evaluateSignals,
      onRevised: ({ revisions }) => {
        revised.push(revisions);
      },
    });
    expect(reconcileCalls).toEqual(["US30", "US30"]);
    expect(evaluateCalls).toEqual(["US30", "US30"]);
    expect(revised).toEqual([1]);
    expect(revisionsBySymbol.get("US30")).toBe(1);
  });
});
