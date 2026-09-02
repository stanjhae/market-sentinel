# ADR-016: Demo execution isolation, v2 orders, and at-most-once send

## Status

Accepted

## Context

SPEC §34 Milestone 9 allows eToro Demo orders after M0–M8. ADR-004 still forbids live-money execution. Issue #16 requires hard isolation so a Real account cannot receive an order by configuration accident.

Hosted `etoro-public-api` MCP remains `needsAuth`. Routes were confirmed from the official eToro API Docs MCP (`api-portal.etoro.com`) — see ADR-007. v1 `market-open-orders/by-amount` is deprecated. Current Demo create is `POST /api/v2/trading/execution/demo/orders`. v2 create documents `action: close` as unsupported.

Issue #16 assumed execution POSTs have no idempotency (older v1). v2 create requires `x-request-id` and echoes it as `referenceId` for lookup after a lost response.

## Decision

### Routes (Demo only)

| Purpose | Path |
| --- | --- |
| What-if costs | `POST /api/v2/trading/info/demo/costs` |
| Open market | `POST /api/v2/trading/execution/demo/orders` |
| Open lookup | `GET /api/v2/trading/info/demo/orders:lookup` |
| Full close | `POST /api/v1/trading/execution/demo/market-close-orders/positions/{positionId}` (`UnitsToDeduct: null`) |
| Close lookup | `GET /api/v1/trading/info/demo/close-orders/{orderId}` |
| Reconcile PnL | `GET /api/v1/trading/info/demo/pnl` |

Real execution paths (`/trading/execution/orders` without `/demo/`, `/trading/execution/real/…`) are not implemented and must not appear in the execution module.

Open body: `action: open`, `orderType: mkt`, `leverage: 1`, exactly one of `amount`, `instrumentId` only (no `symbol`). LONG → `buy`, SHORT → `sellShort`. MIT/limit and SL/TP modify are out of scope.

### Isolation

1. Execution constants live only in `packages/etoro-client/src/execution-demo.ts` and include `/demo/`.
2. `assertDemoExecutionAllowed` requires `ETORO_ACCOUNT_TYPE === "demo"` **and** `DEMO_EXECUTION_ENABLED=true` (default **false**) **and** `APP_PASSWORD` set. Unset password keeps the local API open (ADR-015) but must not unlock Demo sends.
3. Before the first execution POST, probe `GET /api/v1/trading/info/real/pnl` (existing read route). `200` → Real key → refuse. `403 InsufficientPermissions` → Demo key → cache and allow. Any other result → refuse.
4. The Demo client also asserts `accountType === "demo"` and `enabled` before create/close. Read sync still follows ADR-012 (do not probe for account snapshots).
5. API-key headers only. Never Bearer + keys. No leverage UI.

### Preview and confirm

`POST /execution/preview` re-evaluates risk, calls Demo costs, and returns a short-lived HMAC nonce (plan id, amount, SL, TP, candidate `x-request-id`). Amount is `estimatedPositionSize` only — never `riskAmountUsd`. Confirm re-binds nonce amount, SL, TP, and instrument id to the stored plan. It does not POST to execution.

`POST /execution/confirm` requires a valid nonce, re-checks isolation and risk, persists `broker_orders` as `PENDING` with that request id, then sends. Outcomes: `FILLED`, `REJECTED`, `AMBIGUOUS`.

A plan may have at most one open in `PENDING` / `FILLED` / `AMBIGUOUS` (partial unique index). Preview after `PENDING`/`AMBIGUOUS` re-signs the **same** `x-request-id` so confirm resumes. `FILLED` blocks a new preview. `REJECTED` may mint a new id. Confirm is idempotent: the same nonce looks up `referenceId` and does not insert or POST again unless the row is `PENDING` with no recorded response.

Close uses the same preview/confirm pair against a `broker_positions` row, with the same resume rules per position.

### At-most-once

Persist `x-request-id` before the execution POST. Retry **429 only** with the same id and body. Timeout, 5xx, or no response → `AMBIGUOUS`. Never mint a second id while an active row exists. Reconcile via lookup `referenceId`/`orderId`, then Demo `/pnl` only when the **same** `orderId` appears in `positions[]` / `ordersForOpen[]`. An existing position on the same instrument is not a fill. Close lookup uses the same status ids as open (`FILLED` 3/5, `REJECTED` 4/10); anything else stays `AMBIGUOUS` unless Demo PnL no longer lists that `positionId`.

### Audit

Every preview, submit, fill, reject, ambiguous outcome, isolation block, and close action writes `audit_logs`. Successful Trade Gate approval also writes `PLAN_APPROVED`.

## Consequences

A reachable deployment can execute Demo orders only when the env, flag, app password, and key probe all agree. Changing routes, cookie-equivalent nonce TTL, leverage, resume/idempotency rules, or adding Real execution paths requires a new ADR revision. Live-money remains forbidden.
