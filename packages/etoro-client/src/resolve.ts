import type { CanonicalSymbol } from "@market-sentinel/domain";
import type { EtoroRestClient } from "./rest.js";
import type { InstrumentSearchItem } from "./types.js";

export const SYMBOL_ALIASES: Record<CanonicalSymbol, string[]> = {
  US30: ["US30", "DJ30"],
  US100: ["US100", "NSDQ100"],
  SPX500: ["SPX500", "SPX"],
  GOLD: ["GOLD.24-7", "GOLD"],
};

export type ResolvedInstrument = {
  symbol: CanonicalSymbol;
  resolved: boolean;
  ambiguous: boolean;
  instrument: InstrumentSearchItem | null;
};

function normalize(value: string | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

export function pickUnambiguousInstrument(args: {
  symbol: CanonicalSymbol;
  items: InstrumentSearchItem[];
}): ResolvedInstrument {
  const aliases = new Set(SYMBOL_ALIASES[args.symbol].map((alias) => alias.toUpperCase()));
  const exact = args.items.filter((item) => aliases.has(normalize(item.internalSymbolFull)));
  if (exact.length === 1) {
    return { symbol: args.symbol, resolved: true, ambiguous: false, instrument: exact[0] ?? null };
  }
  if (exact.length > 1) {
    return { symbol: args.symbol, resolved: false, ambiguous: true, instrument: null };
  }
  return { symbol: args.symbol, resolved: false, ambiguous: false, instrument: null };
}

export async function resolveWatchlistInstrument(args: {
  client: EtoroRestClient;
  symbol: CanonicalSymbol;
}): Promise<ResolvedInstrument> {
  const collected: InstrumentSearchItem[] = [];
  for (const alias of SYMBOL_ALIASES[args.symbol]) {
    const { data } = await args.client.searchInstruments({
      fields: "instrumentId,displayname,internalSymbolFull,instrumentType,internalAssetClassName,dailyPriceChange",
      pageSize: 20,
      filters: { internalSymbolFull: alias },
    });
    collected.push(...(data.items ?? []));
    const picked = pickUnambiguousInstrument({ symbol: args.symbol, items: collected });
    if (picked.resolved || picked.ambiguous) {
      return picked;
    }
  }
  return pickUnambiguousInstrument({ symbol: args.symbol, items: collected });
}
