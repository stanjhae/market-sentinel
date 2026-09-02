# ADR-007: eToro route discovery source

## Status

Accepted

## Context

SPEC requires hosted eToro MCP (`get-all-routes` / `get-route-spec`) before implementing any endpoint. In this environment:

- project `.cursor/mcp.json` is configured
- hosted `etoro-public-api` MCP sits in `needsAuth` (`POST https://mcp.public-api.etoro.com` returns `401`)
- official routes are still published on api-portal.etoro.com (OpenAPI family `v1.365.1`, current Demo Trading pages)

Issue #20: keep OpenAPI / API Docs as the documented source of truth until the hosted MCP is authenticated. Do not guess hosts or paths.

## Decision

Discover routes from the official eToro API Docs MCP / OpenAPI at api-portal.etoro.com. Cite the artifact and version (or page) on every new eToro route. Do not silently switch hosts.

Milestone 1–8 used read-only routes only. Milestone 9 adds Demo execution routes documented in ADR-016. Real execution paths stay unimplemented.

## Routes used

Read (M1–M8):

- `GET /api/v1/market-data/search`
- `GET /api/v1/market-data/instruments/rates`
- `GET /api/v1/trading/info/aggregate-portfolio` (real)
- `GET /api/v1/trading/info/demo/aggregate-portfolio` (demo)
- `GET /api/v1/trading/info/real/pnl` and `GET /api/v1/trading/info/demo/pnl`
- `GET /api/v1/trading/info/trade/history` and `GET /api/v1/trading/info/trade/demo/history`
- WebSocket `wss://ws.etoro.com/ws` with `Authenticate` + `Subscribe` topics `instrument:{id}`

Demo execution (M9, ADR-016):

- `POST /api/v2/trading/info/demo/costs`
- `POST /api/v2/trading/execution/demo/orders`
- `GET /api/v2/trading/info/demo/orders:lookup`
- `POST /api/v1/trading/execution/demo/market-close-orders/positions/{positionId}`
- `GET /api/v1/trading/info/demo/close-orders/{orderId}`

There is no dedicated eToro health route. Connectivity is probed with a bounded instrument search. Execution isolation probes the existing Real PnL **read** path only.

## Consequences

REST origin is `https://public-api.etoro.com` (OpenAPI `servers.url`). Paths already include `/api/v1` or `/api/v2`. SPEC's `https://public-api.etoro.com/api/v1/` default is therefore a prefix, not the request origin. Authenticate hosted MCP later; do not change this discovery path without a new ADR revision.
