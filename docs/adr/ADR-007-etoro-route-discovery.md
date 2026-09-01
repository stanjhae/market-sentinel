# ADR-007: eToro route discovery source for Milestone 1

## Status

Accepted

## Context

SPEC requires `get-all-routes` / `get-route-spec` on the hosted eToro MCP before implementing any endpoint. In this session:

- project `.cursor/mcp.json` is configured
- the MCP tools were not attached to the agent tool catalog
- `POST https://mcp.public-api.etoro.com` returned `401` requiring `x-api-key` + `x-user-key` even for initialize (skill 1.19.1 claimed the catalog was anonymous)

## Decision

Milestone 1 routes are taken from the live official OpenAPI published at api-portal.etoro.com (document version `v1.365.1`), which is the same document the MCP server refreshes. No money-moving routes are implemented.

## Routes used

- `GET /api/v1/market-data/search`
- `GET /api/v1/market-data/instruments/rates`
- `GET /api/v1/trading/info/aggregate-portfolio` (real)
- `GET /api/v1/trading/info/demo/aggregate-portfolio` (demo)
- WebSocket `wss://ws.etoro.com/ws` with `Authenticate` + `Subscribe` topics `instrument:{id}`

There is no dedicated eToro health route. Connectivity is probed with a bounded instrument search.

## Consequences

REST origin is `https://public-api.etoro.com` (OpenAPI `servers.url`). Paths already include `/api/v1`. SPEC's `https://public-api.etoro.com/api/v1/` default is therefore a prefix, not the request origin.
