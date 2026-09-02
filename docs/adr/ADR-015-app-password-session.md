# ADR-015: Single-user app password and ready-check conjunction

## Status

Accepted

## Context

SPEC §26 allows a strong app password/session for a private deployment. `APP_PASSWORD` was already in the env schema and `.env.example` but no route enforced it. SPEC §28 requires readiness to fail when critical dependencies are unhealthy; `GET /health/ready` listed `checks.database` while computing `ready` without it.

Milestone 9 Demo execution stays blocked until mutating routes can be gated. Issue #21 SSE expansion already shipped in M5/M6.

## Decision

### Ready conjunction

`ready` is `database && redis && credentials && marketStream`. Every check remains listed. A down stream must not hide a database failure.

### When `APP_PASSWORD` is unset

Local open-by-default behavior is unchanged. `GET /auth/session` returns `{ required: false, authenticated: true }`. This is an insecure default and must not be used if the API is reachable beyond localhost.

### When `APP_PASSWORD` is set

- Public routes are exact normalized paths only: `/health/live`, `/health/ready`, `/auth/session`, `/auth/login`, `/auth/logout`, plus CORS `OPTIONS`. `/auth/../account` is not public.
- Every other route, including `GET /account`, settings, and `GET /stream`, returns 401 without a valid session cookie.
- `POST /auth/login` compares the submitted password with `crypto.timingSafeEqual` over SHA-256 digests. Five failures from the same IP lock login for 15 minutes (`429` + `Retry-After`).
- Cookie payload is `{ v: 1, exp }` HMAC-SHA256 keyed from `APP_PASSWORD`. MAC comparison hashes both sides so length cannot short-circuit `timingSafeEqual`. The password is never stored in the cookie, logs, or response bodies.
- Absolute expiry is 12 hours.
- Cookie flags: `HttpOnly; Path=/; SameSite=Lax`, plus `Secure` only on HTTPS. The web app calls `/sentinel-api/*` on the Next.js origin so the cookie is first-party.
- CORS allowlists `http://localhost:${WEB_PORT}` and `http://127.0.0.1:${WEB_PORT}` only. Foreign origins are not reflected. SSE uses the same allowlist.
- A failed `/auth/session` fetch is treated as `{ required: true, authenticated: false }` so EventSource does not retry a gated `/stream`.
- `APP_PASSWORD` is server-only. Never `NEXT_PUBLIC_*`.

### Milestone 9

Demo order adapters remain out of scope until this gate is in place. Live-money execution stays forbidden.

## Consequences

A reachable deployment can require a password before account, settings, and later execution routes. Unset password keeps the local developer loop. Changing cookie flags, TTL, lockout, CORS origins, or the public-route list requires a new ADR revision.
