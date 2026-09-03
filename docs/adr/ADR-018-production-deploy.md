# ADR-018: Private production deploy on GCE + Supabase

## Status

Accepted

## Context

SPEC §23 recommends Docker containers and `infra/docker/`. The repo only had Compose for local Postgres and Redis. API and worker start scripts read `../../.env`, production env accepted an empty `APP_PASSWORD`, and `/health/ready` requires a LIVE eToro stream.

The operator already has GCP, Vercel, and Supabase. ADR-003 keeps the worker off serverless. ADR-015 cookies and `/stream` SSE need one HTTPS origin.

## Decision

**Topology.** One GCP Compute Engine VM runs production Compose: Caddy (TLS), Next.js web, Fastify API, worker, Redis with AOF. Postgres is Supabase. There is no fourth process and no Kubernetes.

**Not Vercel.** The Next.js app stays next to the API. A Vercel origin would make session cookies cross-site (ADR-015) and buffer or time out `EventSource` → `/stream`.

**Not Clerk.** This is a private single-user box. `APP_PASSWORD` remains the gate (SPEC §26 private deploy). Auth.js/Clerk waits until the host is public.

**Fail closed.** `NODE_ENV=production` requires `APP_PASSWORD` (min 12), `DATABASE_URL`, `REDIS_URL`, and both eToro keys. Localhost URL defaults apply only in development and test.

**TLS and cookies.** Caddy terminates HTTPS and routes `/` → web, `/sentinel-api/*` → API (strip prefix, `flush_interval -1` for SSE). Gzip is only on the web handle so `/stream` is not encoded. Fastify `trustProxy` is a one-hop function in production and off otherwise. CORS stay localhost-only; the browser talks same-origin through Caddy. Let's Encrypt HTTP-01 needs **80/443 from the internet**; SSH stays operator-IP-only. `APP_PASSWORD` remains the app gate. `PUBLIC_HOST=:80` is HTTP-only first boot. Without a purchased domain, an IP hostname such as `<ip>.sslip.io` is enough for ACME.

**Database.** Runtime uses `DATABASE_URL` (Supabase pooler allowed). Apply schema with `docker compose --profile migrate run --rm migrate` (uses `DATABASE_DIRECT_URL` when set). Production connections use postgres.js `ssl: true` unless `sslmode=disable`. `sslmode=require` encrypts without CA verify (libpq / Supabase pooler).

**Processes.** App images run as `node`. `PUBLIC_HOST` is required. Do not publish 3000/3001/6379.

**Health.** Container and Caddy checks use `/health/live` only. Operators use `/sentinel-api/health/ready` after the worker is LIVE. Ready must not restart the API on boot.

**Images.** One Dockerfile with targets `api`, `worker`, `web`, `migrate`. CI builds them after verify. Push to Artifact Registry only when `GCP_ARTIFACT_REGISTRY` is set on `main`.

**Demo.** `DEMO_EXECUTION_ENABLED` stays false unless deliberately enabled with `ETORO_ACCOUNT_TYPE=demo`. Live-money execution stays forbidden.

## Consequences

Changing host (Vercel, Cloud Run split), opening CORS, adding Clerk, or gating Caddy on `/health/ready` requires a new ADR revision. SPEC §26 internet auth and §28 OpenTelemetry are deferred.
