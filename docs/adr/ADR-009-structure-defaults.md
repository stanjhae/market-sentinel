# ADR-009: Market-structure numeric defaults and MultiTimeframeContext

## Status

Accepted

## Context

SPEC §7 defines `PriceZone` and `MarketRegime` but not a `Pivot` entity or a `MultiTimeframeContext` schema. SPEC §10–11 leave clustering, equal-high tolerance, break penetration, trend strength, volatility buckets, zone expiry, and 15m timing predicates unspecified. Milestone 3 needs deterministic values shared by live evaluation and replay fixtures.

## Decision

### Pivots

Persisted even though they are not a §7 entity, keyed by `(instrumentId, timeframe, openTimeUtc, type)`.

- `leftBars = 3`, `rightBars = 3`.
- Only **final** candles participate. The open bar is never a confirmation bar.
- Swing high at index `i`: `high[i]` is strictly greater than every high in `[i-left, i)` and `(i, i+right]`. Same rule for lows.
- Equal-price plateaus therefore produce no pivot.

### Equal swings

`|a − b| <= 0.10 * ATR14` of the last confirming bar. If ATR is missing, require exact decimal equality.

### Structure and trend

Last two confirmed highs and last two confirmed lows:

- HH + HL → `HH_HL`
- LH + LL → `LH_LL`
- otherwise `MIXED`

Trend:

- two consecutive agreeing swing pairs (last three highs and three lows all aligned) → `STRONG_BULL` / `STRONG_BEAR`
- one agreeing pair → `BULL` / `BEAR`
- otherwise `RANGE`

### Volatility

Current ATR14 versus the SMA of the last 50 ATR values:

- `< 0.7` LOW
- `0.7–1.3` NORMAL
- `1.3–2.0` HIGH
- `> 2.0` EXTREME

If fewer than 50 ATR samples exist, compare against the available SMA (minimum 14).

### Zones

- Cluster pivot prices within `0.25 * ATR`. Bounds = cluster min/max; midpoint = mid. A single-pivot cluster is a zero-width zone.
- Break: a **crossing** — the previous final close was not beyond the zone, and this close is beyond it by `>= 0.15 * ATR`. A wick alone is a weak touch, not a break. The first bar in a series cannot break (no previous close). Being far from a zone on the last close is not a break.
- `FLIPPED`: after `BROKEN`, a **later** candle (open time after `brokenAt`) whose close remains on the far side; `SUPPORT` ↔ `RESISTANCE`. Re-evaluating the same candle is a no-op (`lastProcessedOpenTime` in zone metadata).
- Wick increments apply only to the latest candle, once per open time.
- `EXPIRED`: no touch in 200 bars of that timeframe and `strengthScore < 20`.
- Auto zones never overwrite `USER_MANUAL`. An auto cluster that overlaps a manual zone is skipped.
- `PRIOR_DAY` / `PRIOR_WEEK`: thin zones from the last **completed** UTC day/week high and low of stored candles. Generated on every timeframe with the same bounds.
- `PSYCHOLOGICAL` is reserved and not generated.

Strength (0–100): base 20, +15 per independent touch (cap 4), +20 if another timeframe overlaps, +10 if last touch is within 20 bars, +10 if the reaction after the last touch is `>= 0.5 ATR`, −10 per weak touch, −40 if broken.

Location:

- `AT_SUPPORT` / `AT_RESISTANCE` when distance to the nearest matching active zone is `<= 0.25 ATR`
- `EXTENDED_UP` / `EXTENDED_DOWN` when close is `>= 1.0 ATR` beyond the nearest opposing zone
- otherwise `MID_RANGE`

### 15m timing predicates (final bars only)

- **rejection**: last wick ratio `>= 0.6` on the side of the nearest zone, and close is back on the origin side of that zone (or, without a zone, close is in the opposite half of the candle from the dominant wick).
- **reclaim**: previous close was beyond a zone; last close is back through to the original side.
- **failedRetest**: previous close was beyond a zone; last bar trades back into the zone but close remains beyond.
- **engulfingImpulse**: last body fully contains the previous body and last body size `>= 0.8 * ATR`.
- **rsiReset**: previous RSI `<= 30` and last RSI `> 35`, or previous RSI `>= 70` and last RSI `< 65`.
- **bbMeanReclaim**: previous close outside the bands; last close inside.
- **bbMeanLoss**: previous close inside the bands; last close outside.

### 1H setup predicates

- **continuation**: `HH_HL` and bullish trend, or `LH_LL` and bearish trend.
- **reversal**: `AT_RESISTANCE` without `HH_HL`, or `AT_SUPPORT` without `LH_LL`.
- **breakout** / **breakdown**: last final close is beyond a resistance / support zone by the break rule.
- **pullback**: bullish trend and `AT_SUPPORT`, or bearish trend and `AT_RESISTANCE`.
- **consolidation**: `MIXED` and `LOW` volatility.
- **structureTransition**: current `structure` differs from the previous persisted regime structure.

### Persistence

SPEC §27 requires manual zones to survive restart. Auto zones, pivots, and the latest regime per `(instrumentId, timeframe)` are also persisted so restarts do not re-emit a different set (§2.5). Regime history is append-only.

### API

SPEC §25 lists `GET`/`POST` for zones. Milestone 3 also exposes `PATCH`/`DELETE` on `/markets/:symbol/zones/:id` so manual zones can be edited and removed.

## Consequences

Live and backtest share these constants. Changing a default requires a new ADR revision, not a silent edit.
