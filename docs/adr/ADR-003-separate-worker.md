# ADR-003: Separate worker process

## Status

Accepted

## Decision

Market-data ingestion, queues, and broker reconciliation run in `apps/worker`, not in Next.js.

## Consequences

Persistent sockets and long jobs are not bound to serverless request lifecycles.
