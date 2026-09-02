# ADR-013: Journal matching, MAE/MFE, and analytics defaults

## Status

Accepted

## Context

SPEC §7.9, §17.6–17.7, §19, and §31 require broker-trade matching, journal rows, MAE/MFE, and gated-vs-ungated analytics. ADR-012 left `ENTERED`/`CLOSED`, `UNGATED_TRADE`, and excursion tracking to Milestone 7. Matching windows, `resultR` denominator, discipline points, historical MAE, and screenshot storage were unspecified.

No new eToro routes. Journal consumes Milestone 6 `broker_positions` and `broker_trades`.

## Decision

### Identity

One journal row per `etoroPositionId`. Open positions attach before a history row exists. `brokerTradeId` is set when the closed history item appears.

### Matching

Unused `APPROVED` TradePlans with the same symbol and direction, `approvedAt <= openedAt`, and `openedAt - approvedAt <= 4 hours`:

- 1 candidate → `LINKED`
- 2+ → `UNMATCHED`
- 0 → `UNGATED`

First create only. A later PATCH that sets or clears `tradePlanId` sets `matchLocked` and is never auto-overwritten.

Already-closed history seen for the first time is `UNGATED` with null MAE/MFE (no live tracking existed). Open positions start excursions on the first live quote after this milestone.

### `resultR`

`realizedPnl / riskAmountUsd` when a linked plan has a risk amount. Otherwise `|openPrice - stopLoss| * units` if both exist. Otherwise null.

### MAE / MFE

Persist dollar and R. LONG adverse = `(entry - last) * units`, favorable = `(last - entry) * units`. SHORT inverted. Restart continues from stored maxima. R uses the same risk denominator as `resultR`.

### Signals

`TRADE_PLANNED → ENTERED` only when a linked open journal exists. `ENTERED → CLOSED` only when that position closes. Strategy evaluation does not invalidate `ENTERED`. ENTERED/CLOSED publish on SSE and write `SIGNAL_STATE_CHANGED` audit; they still do not emit Telegram alerts (ADR-011).

Close policy: if the position is still in `broker_positions`, keep the journal open even when a history row also exists. Close from history only after it leaves positions. If it leaves positions and no history row exists (demo `InsufficientPermissions`), close now with null realized P/L (`position-vanished-without-history`).

### Discipline

Start 100. Deduct 30 for `UNGATED`, 20 when `followedPlan` is false, 10 per listed rule break. Floor at 0. Threshold 70. Do not present the score as a reason to trade more.

Analytics compare `LINKED` (gated) vs not-linked. Empty closed journal returns an empty-state envelope, not zeroed metrics. Null `realizedPnl` is excluded from win-rate, net P/L, drawdown, and after-win/after-loss denominators.

### Screenshots

`POST /journal/:id/screenshot` accepts multipart or JSON base64. Files live under repo-root `data/journal-screenshots/{uuid}.{ext}`, resolved from `import.meta.url` (not `process.cwd()`). `:id` must be a UUID; GET/POST reject path traversal. Type is taken from magic bytes, not the declared MIME. GET 404s when the id is unsafe, the journal row is missing, or the file is absent. Max 5MB. `screenshotUrl` is `/journal/:id/screenshot`.

## Consequences

Changing the match window, discipline points, or `resultR` fallback requires a new ADR revision. Demo `historyUnavailable` is a banner, not an empty journal: open rows still list. Manual `PATCH tradePlanId` rejects missing, unapproved, symbol/direction-mismatched (400), and already-used plans (409).
