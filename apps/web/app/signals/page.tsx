import { SignalsBoard } from "@/components/signals-board";

export default function SignalsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Signals</h1>
      <SignalsBoard />
    </div>
  );
}
