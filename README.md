# Market Sentinel

Personal market-intelligence and trading-discipline platform. It watches configured eToro instruments, explains setups, and enforces risk rules. It is **not** an autonomous live-money trading bot.

See `SPEC.md` for the product contract.

## Architecture

```text
apps/web      Next.js dashboard (no eToro secrets)
apps/api      Fastify HTTP + health/SSE
apps/worker   Persistent market-data process
packages/*    Pure domain, broker client, db, config
```

```mermaid
flowchart LR
  etoroREST[eToro REST]
  etoroWS[eToro WebSocket]
  worker[apps/worker]
  api[apps/api]
  web[apps/web]
  pg[(Postgres)]
  redis[(Redis)]
  etoroREST --> worker
  etoroWS --> worker
  worker --> redis
  worker --> pg
  api --> pg
  api --> redis
  web -->|SSE| api
```

## Tech stack

pnpm, Turborepo, Next.js, Fastify, Zod, Drizzle, PostgreSQL, Redis, Vitest, Playwright, Pino.

## Setup

```bash
cp .env.example .env
# add ETORO_API_KEY and ETORO_USER_KEY to .env — never NEXT_PUBLIC_*
docker compose up -d
pnpm install
pnpm --filter @market-sentinel/db migrate
pnpm dev
```

Validation:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

## eToro API / MCP

`.cursor/mcp.json` points at the hosted eToro Public API MCP server. Before implementing any eToro route, use the official API Docs / OpenAPI (hosted MCP often requires auth). Do not invent endpoints. See `docs/adr/ADR-007-etoro-route-discovery.md`.

Register keys at [api-portal.etoro.com](https://api-portal.etoro.com/).

## Environment

| Variable | Where | Notes |
| --- | --- | --- |
| `ETORO_API_KEY` | server only | Never `NEXT_PUBLIC_` |
| `ETORO_USER_KEY` | server only | Never `NEXT_PUBLIC_` |
| `ETORO_ACCOUNT_TYPE` | server only | `real` or `demo`. Default `real`. Never `NEXT_PUBLIC_` |
| `DEMO_EXECUTION_ENABLED` | server only | Default false. Demo orders require this, `ETORO_ACCOUNT_TYPE=demo`, and `APP_PASSWORD`. Never `NEXT_PUBLIC_` |
| `DATABASE_URL` | server | Postgres |
| `REDIS_URL` | server | Redis |
| `APP_PASSWORD` | server only | Optional. Unset is an insecure local default. When set (min 12), the API and UI require a session. Never `NEXT_PUBLIC_` |
| `TELEGRAM_BOT_TOKEN` | server only | Optional. Never `NEXT_PUBLIC_` |
| `TELEGRAM_CHAT_ID` | server only | Optional. Never `NEXT_PUBLIC_` |

## Safety

Live-money order placement is forbidden. Demo orders require `ETORO_ACCOUNT_TYPE=demo`, `DEMO_EXECUTION_ENABLED=true`, `APP_PASSWORD`, a Demo user-key probe, preview, and explicit confirm. See `docs/adr/ADR-016-demo-execution-isolation.md`.

Leaving `APP_PASSWORD` empty keeps the local API and UI open. Set it before exposing the API beyond localhost.

The Next.js app proxies `/sentinel-api/*` to the Fastify process so session cookies are first-party (`SameSite=Lax`). Do not set `NEXT_PUBLIC_API_BASE_URL` to the API origin unless you also terminate HTTPS and accept a looser cookie policy.

## Strategies

Four versioned detectors ship in Milestone 4: `breakdown-retest@1.0.0`, `sweep-reclaim@1.0.0`, `trend-pullback@1.0.0`, and advisory `do-not-chase@1.0.0`.

## Roadmap

0. Repo foundation
1. eToro connectivity
2. Candles and indicators — `/markets/:symbol` chart, 15m/1h/4h storage, RSI/ATR/EMA/BB
3. Structure and zones — pivots, HH/HL/LH/LL, auto/manual zones, regime, MultiTimeframeContext
4. Signals
5. Alerts — in-app inbox, optional Telegram, event-driven SSE
6. Account / risk / Trade Gate — official PnL snapshot, positions/history, risk engine, manual news blackouts
7. Journal and analytics — broker matching, MAE/MFE, gated vs ungated
8. Backtest / replay — event loop, walk-forward, lookahead-free Replay UI
9. Demo execution only
