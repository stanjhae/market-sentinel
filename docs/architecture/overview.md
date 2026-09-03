# Architecture overview

Market Sentinel is a TypeScript monorepo with three long-running processes:

- `apps/web` — Next.js dashboard (no eToro credentials)
- `apps/api` — Fastify HTTP + SSE for the web app
- `apps/worker` — persistent eToro WebSocket, in-process ticks, and BullMQ scheduled jobs (ADR-017)

Shared packages keep domain math, broker adapters, and persistence isolated. See `SPEC.md` for the product contract.
