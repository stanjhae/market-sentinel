import { TIMEFRAMES, isWatchlistSymbol } from "@market-sentinel/domain";
import { MarketDetail } from "@/components/market-detail";
import { notFound } from "next/navigation";

export default async function MarketPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const normalized = symbol.toUpperCase();
  if (!isWatchlistSymbol(normalized)) {
    notFound();
  }
  return <MarketDetail symbol={normalized} timeframes={TIMEFRAMES} />;
}
