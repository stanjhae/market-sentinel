# ADR-014: Backtest event loop, fills, and replay defaults

## Status

Accepted

## Context

SPEC §20–21, §29–30, and §34 M8 require an event-driven backtest that reuses live strategy code, walk-forward splits, and a lookahead-free replay UI. Fill timing, cost defaults, walk-forward windows, job hosting, and paper-trade persistence were unspecified.

No new eToro routes. The engine reads finalized `candles` already stored by the worker.

## Decision

### Same engine as live

`packages/backtest` iterates **final** 15m closes only. Each step rebuilds indicators and structure from the prefix `candles[0..i]`, builds a `StrategySnapshot`, then calls `evaluateAllStrategies` + `applySignalTransition`. Live `signals`, `pivots`, `price_zones`, and `journal_entries` are never written.

Open candles never enter the snapshot. Pivots still require M3 `rightBars` of later **final** bars inside that prefix. `INDICATOR_LOOKBACK` is 228 (EMA 200 + RSI warmup). Prefix `i` must not read bar `i+1`.

`simulateSignalSequence` walks SPEC §29 fixture snapshots through the same machine. The candle loop is the live-simulation; running it twice on one series must match.

### Simulated fills

Signal sequence is the source of truth. Trades are simulated only from `CONFIRMED` (not `TRADE_PLANNED`).

- Entry: next 15m **open** after confirm, plus slippage (price units). Spread is an adverse entry adjustment.
- If that open gaps through invalidation/stop, record `unfillable: gap` and do not fill.
- Exit: first later bar whose high/low touches stop (invalidation) or T1. Same-bar conflict → stop wins.
- Expiry/invalidation with no fill = no trade. A setup that is `INVALIDATED`, `EXPIRED`, or `DISMISSED` at a timestamp strictly before the entry bar open is skipped. Invalidation on the entry bar (evaluated at that bar's close) does not cancel the open fill.
- Fees (`feeBps`) are deducted on close.
- A window must not score exits that require bars after the window end; those trades stay `open` and are excluded from closed metrics.

### Walk-forward

No parameter search. In-sample is the first 70% of the requested range, out-of-sample the last 30%. When the range is ≥ 180 days, also emit rolling 90d IS / 30d OOS windows stepping 30d. Windows are half-open `[from, to)`. A bar whose open is `>= window.to` is excluded. If `window.to` is before the first bar, the window is empty — it never falls back to the full series. When the range is inferred from candles, `to` is the last bar's **close** so the last bar is included.

Warmup bars before a window start may build indicators/structure; signals and fills count only inside the window. Walk-forward reuses the single full-range event loop (no second/third structure rebuild). `strategyKey@version` is stored on every simulated trade.

### Warmup and higher timeframes

The API loads `structureLookback` (500) 15m intervals before the requested `from`. Signals and fills start at `max(first in-range bar, indicatorLookback - 1)`. Missing pre-range history is not invented; evaluation waits until 228 finalized 15m bars exist in the prefix.

Empty `1h` / `4h` arrays are treated as missing. The snapshot then aggregates those timeframes from finalized 15m prefixes (`higherPrefix`). Higher-timeframe structure and indicators are reused until that timeframe prints a new final close — matching live (1h regime does not rebuild on every 15m bar). API runs skip full structure during indicator warmup and do not retain per-bar snapshots in memory.

### Jobs and replay paper-trade

Runs execute in-process on the API. BullMQ remains backlog #18. The event loop yields every `yieldEveryBars` (32) bars so `/health` and SSE can interleave.

Replay paper trades are session-local. They are not journaled and are not sent to eToro. A fill at step N uses the same fill rules against bars `<= N`. Paper entry is the visible bar's open (including index 0). Stop/target must be finite decimal strings.

Replay `datetime-local` inputs are interpreted as UTC, not the browser local zone.

### Persistence

`backtest_runs` stores both backtests and replay sessions (`kind`). Result JSON holds trades, metrics, and (for `kind=replay` only) compact frames: slim signals, zones with stable fallback ids, and as-of indicator values per timeframe. Backtest runs omit frames. Insufficient history returns an empty envelope, not invented bars.

## Consequences

Changing fill timing, cost defaults, or walk-forward windows requires a new ADR revision. Demo execution stays Milestone 9.
