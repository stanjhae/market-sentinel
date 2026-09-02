import { ReplayBoard } from "@/components/replay-board";

export default function ReplayPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Replay / Backtest</h1>
      <ReplayBoard />
    </div>
  );
}
