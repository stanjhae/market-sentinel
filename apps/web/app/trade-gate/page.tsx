import { TradeGateBoard } from "@/components/trade-gate-board";
import { Suspense } from "react";

export default function TradeGatePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Trade Gate</h1>
      <Suspense fallback={<p className="font-mono text-xs text-muted-foreground">Loading Trade Gate…</p>}>
        <TradeGateBoard />
      </Suspense>
    </div>
  );
}
