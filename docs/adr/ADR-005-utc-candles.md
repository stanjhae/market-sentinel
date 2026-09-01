# ADR-005: UTC candle boundaries

## Status

Accepted

## Decision

All timestamps are stored and bucketed in UTC. Candle aggregation uses deterministic UTC boundaries.

## Consequences

Live and backtest engines share the same clock semantics.
