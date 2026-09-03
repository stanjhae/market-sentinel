# Deploy Market Sentinel (private GCP VM)

Private single-user production. See [ADR-018](../adr/ADR-018-production-deploy.md). Do not put eToro keys or `APP_PASSWORD` in `NEXT_PUBLIC_*`.

## What you need

- GCP project with Compute Engine and (optional) Artifact Registry
- Supabase Postgres
- A DNS name pointing at the VM, or `PUBLIC_HOST=:80` for HTTP-only first boot
- eToro API key + user key
- `APP_PASSWORD` of at least 12 characters

## 1. Supabase

1. Create a project. Copy the **transaction pooler** URI (port 6543) into `DATABASE_URL`. Runtime disables postgres.js prepared statements on that port.
2. Copy the **session pooler** URI (port 5432, same `*.pooler.supabase.com` host) into `DATABASE_DIRECT_URL`. The `db.<ref>.supabase.co` host is IPv6-only; skip it unless the VM has IPv6 or you enable the IPv4 add-on.
3. Append `?sslmode=require` to both. The client verifies the bundled Supabase CA.
4. Apply migrations on the VM with `docker compose --profile migrate run --rm migrate` each time schema changes. Do not rely on `up -d` to migrate.

## 2. GCP VM

1. Create an `e2-small` or `e2-medium` VM (2 GB RAM minimum; 4 GB is more comfortable for Next + worker). Debian or Ubuntu, Docker + Compose plugin installed.
2. Firewall: allow **80/443 from the internet** (Let's Encrypt HTTP-01). Keep **SSH operator-IP-only** (or IAP). Do not publish 3000, 3001, or 6379.
3. Optional Artifact Registry repo, e.g. `us-central1-docker.pkg.dev/PROJECT/market-sentinel`. Set GitHub Actions variable `GCP_ARTIFACT_REGISTRY` to that prefix and add Workload Identity secrets `GCP_WORKLOAD_IDENTITY_PROVIDER` + `GCP_SERVICE_ACCOUNT` so `main` pushes images.

## 3. Env file

On the VM:

```bash
sudo mkdir -p /opt/market-sentinel
sudo chmod 700 /opt/market-sentinel
# copy repo or compose files here
cp .env.production.example /opt/market-sentinel/.env.production
chmod 600 /opt/market-sentinel/.env.production
```

Fill every required field. Keep `DEMO_EXECUTION_ENABLED=false` unless you want Demo orders. `REDIS_URL=redis://redis:6379` is correct inside Compose.

HTTP-only bring-up: set `PUBLIC_HOST=:80`. For TLS without a purchased domain, point `PUBLIC_HOST` at `<vm-ip>.sslip.io` (or your own A record) and set `ACME_EMAIL`. Recreate Caddy after changing `PUBLIC_HOST`.

## 4. First boot

From the repo root on the VM:

```bash
docker compose -f infra/docker/docker-compose.prod.yml --env-file /opt/market-sentinel/.env.production build
docker compose --profile migrate -f infra/docker/docker-compose.prod.yml --env-file /opt/market-sentinel/.env.production run --rm migrate
docker compose -f infra/docker/docker-compose.prod.yml --env-file /opt/market-sentinel/.env.production up -d
```

`run --rm migrate` applies Drizzle against the direct URL every time you invoke it. `up -d` does not migrate. Caddy waits on `/health/live` only. `PUBLIC_HOST` must be set or Compose refuses to start.

Confirm:

```bash
curl -fsS "https://$PUBLIC_HOST/health/live"
curl -fsS "https://$PUBLIC_HOST/sentinel-api/health/live"
# /health/ready is session-gated when APP_PASSWORD is set. Sign in first, then:
curl -fsS -b "sentinel_session=..." "https://$PUBLIC_HOST/sentinel-api/health/ready"
```

Ready is `true` only after the worker is LIVE with eToro. Login at `/login` before treating a `ready: false` boot as a failure.

## 5. Rotate APP_PASSWORD

1. Update `APP_PASSWORD` in `.env.production`.
2. `docker compose -f infra/docker/docker-compose.prod.yml --env-file /opt/market-sentinel/.env.production up -d api worker`
3. Existing session cookies are invalid (HMAC key changed). Sign in again.

## 6. Backups

Supabase manages Postgres backups. Redis AOF is on the VM volume `redis_data` — enough to keep BullMQ state across restarts, not a disaster-recovery store. Snapshot the VM if you want the volume.

## 7. Rollback

If `IMAGE_HOST` / `IMAGE_TAG` point at Artifact Registry:

```bash
IMAGE_TAG=<previous-sha> docker compose -f infra/docker/docker-compose.prod.yml --env-file /opt/market-sentinel/.env.production pull
IMAGE_TAG=<previous-sha> docker compose --profile migrate -f infra/docker/docker-compose.prod.yml --env-file /opt/market-sentinel/.env.production run --rm migrate
IMAGE_TAG=<previous-sha> docker compose -f infra/docker/docker-compose.prod.yml --env-file /opt/market-sentinel/.env.production up -d
```

Local builds: check out the previous git SHA, `compose build`, `run --rm migrate`, then `up -d`.

## 8. Safety

- Live-money execution is forbidden.
- Do not set `NEXT_PUBLIC_API_BASE_URL` to the API origin.
- Do not expose the API or Redis on the public NIC.
- Unset `APP_PASSWORD` is rejected in production.
