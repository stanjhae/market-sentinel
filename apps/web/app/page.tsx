import { WATCHLIST } from "@market-sentinel/domain";
import { Dashboard } from "@/components/dashboard";

export default function HomePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Watchlist</h1>
      <Dashboard symbols={[...WATCHLIST]} />
    </div>
  );
}
