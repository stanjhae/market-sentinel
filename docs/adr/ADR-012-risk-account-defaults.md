# ADR-012: Account sync, risk defaults, and Trade Gate

## Status

Accepted

## Context

SPEC §7.10, §14, §15, and §18 leave daily-PnL composition, history lookback, `ENTERED` timing, and blackout window bounds open. Milestone 1 stored a coarse snapshot from `GET /api/v1/trading/info/aggregate-portfolio`. Official account math uses `GET /api/v1/trading/info/{env}/pnl` → `clientPortfolio`.

Hosted `etoro-public-api` MCP required authentication in this session. Routes and field names were confirmed from the official eToro API Docs MCP (`api-portal.etoro.com`) before implementation. No money-moving paths were added.

## Decision

### eToro routes

| Purpose | Real | Demo |
| --- | --- | --- |
| Account snapshot | `GET /api/v1/trading/info/real/pnl` | `GET /api/v1/trading/info/demo/pnl` |
| Closed history | `GET /api/v1/trading/info/trade/history` | `GET /api/v1/trading/info/trade/demo/history` |

Route by `ETORO_ACCOUNT_TYPE`. Do not probe the key. API-key headers only (never Bearer + keys). Aggregate-portfolio is no longer the live snapshot or risk source.

Wire types stay per-endpoint: PnL identifiers are capital-suffix (`positionID`, `instrumentID`); history is lowerCamel (`positionId`, `instrumentId`). Translate once into domain `BrokerTrade` / `BrokerPosition`.

### Account math

Available Cash, Total Invested, Profit/Loss, and Equity follow the official eToro account-snapshot formulas. Persist those decimal strings plus `rawPayloadJson`. Display positions come from `clientPortfolio.positions[]` only. Mirrors are walked only for the official formulas and instrument-id enrichment.

### Daily PnL and session risk

Daily PnL (UTC day) = sum of closed-trade `netProfit` with `closeTimestamp` in the current UTC day + current unrealized from the official formula. Mark-to-market counts toward the daily loss budget.

Consecutive losses: closed trades only, ordered by `closeTimestamp`. A streak of `netProfit < 0` from the most recent close. A win resets. Default block at 2.

Cooldown: last losing close + `cooldownAfterLossMinutes` (default 15). `POST /risk/cooldown` can set or extend a manual until-timestamp. State lives in Postgres `risk_state`.

History lookback is **30 days**. Paginate with `minDate` / `page` / `pageSize`. Keep each window under one year. Demo `InsufficientPermissions` is `historyUnavailable`, not a generic auth failure; PnL and open positions still sync.

Poll every **60 seconds**. `POST /account/sync` is allowed and debounced 10 seconds. Conflict = same `etoroPositionId` with a changed open rate, units, or open time → `RECONCILIATION_CONFLICT` audit, keep the previous row.

### Trade Gate and signals

`ENTERED` and `CLOSED` stay unreachable until Milestone 7 matching. Approving a plan reaches `TRADE_PLANNED` only. New or missing broker positions emit `POSITION_DETECTED` / `POSITION_CLOSED` and do not auto-advance signals.

US30, US100, and SPX500 share one equity-index correlation bucket. GOLD is its own bucket. Count open broker positions in the bucket plus approved open TradePlans.

If the last closed trade lost: reject a plan whose `riskPct` exceeds the profile max **or** the previous approved plan’s `riskPct`. No martingale.

Blackout window is half-open: `[scheduledAtUtc - before, scheduledAtUtc + after)`. An event at T with ±10 minutes blocks T−10m and T+9m and allows T+10m.

Risk profile defaults match SPEC §7.10. `PATCH /settings/risk` is live. `RISK_LIMIT_HIT`, `POSITION_DETECTED`, and `POSITION_CLOSED` are live alert types.

## Consequences

Worker sync, API evaluate-plan, and score hard filters share `RISK_DEFAULTS`. Changing a default requires a new ADR revision. Journal matching, MAE/MFE, and `UNGATED_TRADE` remain Milestone 7.
