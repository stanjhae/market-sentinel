# ADR-010: Strategy evaluation snapshot, identity, and Milestone 4 defaults

## Status

Accepted

## Context

SPEC §12 defines `Strategy.evaluate(ctx: MultiTimeframeContext)`. Milestone 3’s `MultiTimeframeContext` is flag-only (4H trend/S/R, 1H setup, 15m timing). That object cannot compute ATR penetration, R:R to the next zone, RSI extremes, or EMA distance. Milestone 4 also needs identity, expiry, and hard-filter rules that SPEC leaves open.

## Decision

### Evaluation input

Keep a versioned `Strategy` interface. `evaluate` takes named arguments `{ snapshot: StrategySnapshot }`.

`StrategySnapshot` includes:

- `multiTimeframe` (the §11 object)
- last **final** close and its UTC open time
- per-timeframe finalized bars, regimes, and indicator values
- active and recently broken zones
- `streamFreshness`

Open candles never participate. Strategies are pure: same snapshot → same `StrategyEvaluation`.

### Numeric defaults

- Break penetration: reuse `STRUCTURE_DEFAULTS.breakPenetrationAtr` (`0.15` ATR).
- Minimum R:R to confirm: `2.0` (SPEC §7.10). Stored as `STRATEGY_DEFAULTS.minRewardRisk`, not a live risk engine.
- Important zone: `strengthScore >= 40` and status `ACTIVE` or `BROKEN`.
- Retest proximity: last bar overlaps the zone or comes within `0.25` ATR of its near bound.
- DO_NOT_CHASE: RSI `< 25` and close below the lower Bollinger band, or RSI `> 75` and close above the upper band, or last true range `> 1.5` ATR while price is within `0.25` ATR of the opposing zone.
- Expiry: `DETECTED` or `WATCHING` with no forward progress for `48` closed 15m bars.
- Setup gone: `CONFIRMED` or `TRADE_PLANNED` plus a later `NONE` is `INVALIDATED` so the identity slot is released. `ENTERED` is left for Milestone 6.
- Identity: at most one non-terminal signal per `(instrumentId, strategyKey, direction)`.
- Directional strategies emit both LONG and SHORT each cycle (unused side is `NONE`). `evaluate()` still returns the preferred side for replay.
- Dashboard “best” score ignores `do-not-chase`.
- `nextTarget` only uses a zone on the reward side of price. No nearest-zone fallback.
- Backfill evaluates with `streamGate: "historical"` (treat as `LIVE`). Live and reconcile still freeze on known `STALE` / `DISCONNECTED`. Credentialed boot writes `DELAYED` until the socket reports.

### State machine

Legal forward edges only. A first appearance always lands on `DETECTED` even if the strategy proposes `WATCHING` or `CONFIRMED`. Duplicate evaluation of the same final candle open time is a no-op. `TRADE_PLANNED` is only reachable via `POST /signals/:id/create-plan` (stub body, no `trade_plans` table, no `ENTERED`).

### Hard filters

Insufficient data and a known stale/disconnected stream freeze live evaluation (no create, advance, or expire) and force display score `0` while keeping the raw factor breakdown. Empty zones are not insufficient data for `do-not-chase`. Daily loss, consecutive loss, cooldown, and news blackout are live hard filters as of ADR-012.

R:R below `2.0` blocks a `CONFIRMED` display score (`0` + `blockedReason`) but does not hide `DETECTED` / `WATCHING`.

### DO_NOT_CHASE gate

While `do-not-chase@1.0.0` proposes `DETECTED` on an instrument, `trend-pullback` is suppressed unless 15m `rsiReset`, `reclaim`, or `failedRetest` is true.

## Consequences

Live worker evaluation and replay fixtures share `STRATEGY_DEFAULTS`. Changing a default requires a new ADR revision. `create-plan` remains a state-only stub until Milestone 6.
