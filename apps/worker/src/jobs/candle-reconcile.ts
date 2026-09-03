import type { CanonicalSymbol } from "@market-sentinel/domain";
import type { InstrumentRef } from "../candle-store.js";

export async function runCandleReconcile(args: {
  instruments: InstrumentRef[];
  reconcileOne: (args: { instrument: InstrumentRef }) => Promise<number>;
  evaluateSignals: (args: { instrument: InstrumentRef }) => Promise<void>;
  onRevised?: (args: { symbol: CanonicalSymbol; revisions: number }) => void;
  onError?: (args: { symbol: CanonicalSymbol; error: unknown }) => void;
}): Promise<void> {
  for (const instrument of args.instruments) {
    try {
      const revisions = await args.reconcileOne({ instrument });
      await args.evaluateSignals({ instrument });
      if (revisions > 0) {
        args.onRevised?.({ symbol: instrument.symbol, revisions });
      }
    } catch (error) {
      args.onError?.({ symbol: instrument.symbol, error });
    }
  }
}
