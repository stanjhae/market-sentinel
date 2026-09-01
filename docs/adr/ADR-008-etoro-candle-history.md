# ADR-008: Official eToro candle history route

## Status

Accepted

## Decision

Historical OHLCV is fetched only from OpenAPI v1.365.1:

`GET /api/v1/market-data/instruments/{instrumentId}/history/candles/{direction}/{interval}/{candlesCount}`

Mapped intervals: `15m → FifteenMinutes`, `1h → OneHour`, `4h → FourHours`. Requests use `desc` plus `candlesCount <= 1000`, then sort by `fromDate` ascending. Live candles are aggregated from the existing WebSocket quote stream and reconciled against this REST route. REST `fromDate` is normalized onto UTC timeframe buckets before persistence so REST and stream share the same unique key. REST may seed an open bucket before the stream starts and may revise finalized bars on a material OHLC discrepancy (`revision++`). REST must not overwrite a stream-owned open candle. The worker finishes historical backfill before subscribing to the quote stream.

## Consequences

The hosted eToro MCP catalog is not required at runtime. Candle ingest stays inside the 120/60s shared market-data quota.
