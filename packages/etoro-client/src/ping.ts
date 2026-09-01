import { WATCHLIST } from "@market-sentinel/domain";
import { EtoroRestClient, resolveWatchlistInstrument } from "./index.js";

const apiKey = process.env.ETORO_API_KEY;
const userKey = process.env.ETORO_USER_KEY;
if (!apiKey || !userKey) {
  throw new Error("ETORO_API_KEY and ETORO_USER_KEY are required");
}

const client = new EtoroRestClient({
  apiKey,
  userKey,
  accountType: process.env.ETORO_ACCOUNT_TYPE === "demo" ? "demo" : "real",
  restBaseUrl: process.env.ETORO_REST_BASE_URL ?? "https://public-api.etoro.com",
  wsUrl: process.env.ETORO_WS_URL ?? "wss://ws.etoro.com/ws",
});

const ping = await client.ping();
console.log(JSON.stringify({ pingOk: ping.ok }));

for (const symbol of WATCHLIST) {
  const resolved = await resolveWatchlistInstrument({ client, symbol });
  console.log(
    JSON.stringify({
      symbol,
      resolved: resolved.resolved,
      ambiguous: resolved.ambiguous,
      instrumentId: resolved.instrument?.instrumentId ?? null,
      displayName: resolved.instrument?.displayname ?? null,
      internalSymbol: resolved.instrument?.internalSymbolFull ?? null,
    }),
  );
}

const ids = (
  await Promise.all(WATCHLIST.map((symbol) => resolveWatchlistInstrument({ client, symbol })))
)
  .map((item) => item.instrument?.instrumentId)
  .filter((id): id is number => typeof id === "number");

if (ids.length > 0) {
  const rates = await client.getInstrumentRates({ instrumentIds: ids });
  console.log(
    JSON.stringify({
      rates: (rates.data.rates ?? []).map((rate) => ({
        instrumentID: rate.instrumentID,
        bid: rate.bid,
        ask: rate.ask,
        lastExecution: rate.lastExecution,
      })),
    }),
  );
}

const account = await client.getAggregatedPortfolio();
const totals = account.data.accountTotals;
console.log(
  JSON.stringify({
    accountOk: true,
    hasTotals: Boolean(totals),
    currency: account.data.accountCurrency ?? null,
  }),
);
