# ADR-002: WebSocket + REST reconciliation

## Status

Accepted

## Decision

Live prices arrive over the eToro WebSocket. Official REST candles/rates remain the reconciliation source. Material discrepancies prefer REST and increment a candle revision.

## Consequences

The stream can be stale or reconnecting without silently corrupting finalized history.
