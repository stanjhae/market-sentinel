# ADR-017: Durable job queue inside the worker

## Status

Accepted

## Context

SPEC §8.5 and §23 recommend BullMQ/Redis for asynchronous jobs. The worker ran candle reconcile, account sync, and a `forceAccountSync` poll on `setInterval`. Issue #18 requires a durable, idempotent queue and exposure of queue depth and worker lag (SPEC §28). Demo confirm already classifies `PENDING` / `AMBIGUOUS` inline; Phase 3 still needed a background reconcile that never POSTs.

Live ticks, startup backfill, per-tick signal evaluation, and API backtests (ADR-014) stay in-process.

## Decision

BullMQ Queue + Worker run **inside** `apps/worker`. There is no fourth process. Prefix `sentinel:bull`. Queue name `sentinel`. Concurrency 1.

| Job | Repeat | Work |
| --- | --- | --- |
| `candle-reconcile` | 120s | Existing REST candle reconcile + signal eval (ADR-002) |
| `account-sync` | 60s; extra add `{ force: true }` after a Demo fill | Existing account/risk upsert |
| `execution-reconcile` | 30s | Lookup / Demo PnL only for `PENDING`/`AMBIGUOUS` `broker_orders`. Never create or close. Skip unless `ETORO_ACCOUNT_TYPE=demo` and a Demo client exists |

`REDIS_KEYS.forceAccountSync` remains a fallback poll so a missed enqueue still syncs.

Safety:

- Queue and Worker use **separate** ioredis connections (`maxRetriesPerRequest: null`). Stats publish uses the existing app Redis and must not fail the job.
- Repeatables set `immediately: false` so the first run waits a full interval (startup still calls `syncAccount()` once). Completed/failed jobs keep the last 20/50 records. Worker `lockDuration` is 30 seconds (auto-renewed while the handler runs) so a crashed worker unblocks within one stall interval. Startup removes leftover `active` jobs. Queue stats publish in `finally`.
- `execution-reconcile` is scheduled only when `ETORO_ACCOUNT_TYPE=demo` and `DEMO_EXECUTION_ENABLED=true`. It updates only rows still `PENDING`/`AMBIGUOUS`. A close without `positionId` is skipped (never treated as an open).

Queue stats (`depth`, `updatedAt`) are written to `REDIS_KEYS.queueStats`. `/health/ready` surfaces `queueDepth` and `workerLagMs` (`now - updatedAt`) as nullable, non-gating fields. Readiness still uses only database, redis, credentials, and market stream.

## Consequences

Changing job names, repeat intervals, moving ticks/backtests onto the queue, or splitting a fourth process requires a new ADR revision. Live-money execution stays forbidden.
