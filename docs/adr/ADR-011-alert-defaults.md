# ADR-011: Alert defaults, dedupe, and Milestone 5 delivery

## Status

Accepted

## Context

SPEC §7 has no Alert entity. SPEC §16 lists channels, types, and throttle rules without numeric defaults, a persistence shape, or restart behavior. Milestone 5 also expands SSE (issue #21) while Milestone 6 account/risk events do not exist yet.

## Decision

### Package boundary

No `packages/alerts`. Pure helpers live in `packages/domain` (`alerts.ts`). Worker and API perform I/O only.

### Historical mute

`streamGate === "historical"` never creates or sends alerts. Backfill after restart must not replay the historical signal set.

### Dedupe key

`type:instrumentId:subjectId:qualifier`

- `subjectId` is `signalId`, `zoneId`, `score`, or `stream`.
- `qualifier` is the signal state, zone status, score band, location, or an episode timestamp (ISO UTC) when the same logical subject can recur (score re-cross, later stale episode).
- The key is unique in `alerts`. The same key is never delivered twice, including across restarts.

### Cooldown versus dedupe

Default cooldown is **30 minutes** per `(symbol, type)` after a successful send. Configurable via settings.

Cooldown suppresses **send**. If cooldown blocks, **do not** insert the dedupe key so a later qualifying event after the window can send.

### Score cross

Emit `WATCHLIST_OPPORTUNITY` when the instrument’s best **trade-setup** score (ignore `do-not-chase`, ADR-010) crosses **70** (Watch) by a **delta of 10**. Crossing down does not alert. **Unknown previous score (`null`, including a Redis cache miss after restart) does not alert** — treat it as “no observed cross,” not as a jump from 0. Qualifier includes the evaluating 15m open time so a later re-cross can fire.

`MAJOR_LEVEL_APPROACHING` qualifier includes the evaluating bar open time (UTC ISO) so leaving and re-entering the same zone can alert again after cooldown.

`STREAM_STALE` episode is persisted in Redis (`sentinel:stream:stale-episode`). A worker restart while still stale does not emit again. Clearing STALE deletes the key so a later stale episode can fire. Stream SSE frames are published on **status transitions only**, never on every tick.

### Telegram

Optional `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Server-side only; never `NEXT_PUBLIC_*`. Missing credentials skip Telegram; in-app still works. POST `https://api.telegram.org/bot{token}/sendMessage` once. Do not retry 5xx, timeouts, or parse errors (at-most-once).

### SSE reconnect

Do not use `Last-Event-ID` to replay. On connect: current markets snapshot plus unread count. Live frames are new `signal`, `alert`, and `stream` events. `account` and `risk` event types are reserved with empty payloads until Milestone 6.

### User-initiated and terminal skips

`DISMISSED` and `TRADE_PLANNED` do not alert. `EXPIRED`, `ENTERED`, and `CLOSED` have no §16.2 type and do not alert.

### Milestone 6 stubs

`RISK_LIMIT_HIT`, `POSITION_DETECTED`, and `POSITION_CLOSED` were typed and stubbed until Milestone 6. They are live as of ADR-012.

### Settings

Single-row `app_settings` id `default`. `PATCH /settings/alerts` is live. `PATCH /settings/risk` and `PATCH /settings/markets` persist JSON only and do not activate Milestone 6/7 behavior.

Default `alertsJson`:

```json
{
  "enabled": true,
  "browserEnabled": true,
  "telegramEnabled": true,
  "scoreThreshold": 70,
  "scoreDelta": 10,
  "cooldownMinutes": 30,
  "mutedTypes": [],
  "mutedSymbols": []
}
```

### Copy

Deterministic template, no LLM. Title: `{SYMBOL} — {DIRECTION} {HEADLINE} — {score}/100`. Body is one paragraph from stored evidence fields.

## Consequences

Live delivery and unit tests share `ALERT_DEFAULTS`. Changing a default requires a new ADR revision. BullMQ remains out of scope (issue #18); delivery uses Redis pub/sub `sentinel:events`.
