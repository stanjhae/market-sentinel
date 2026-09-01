-- Milestone 0/1 schema stub. Apply with `pnpm --filter @market-sentinel/db migrate` after docker compose is up.

CREATE TABLE IF NOT EXISTS instruments (
  id text PRIMARY KEY,
  etoro_instrument_id integer,
  canonical_symbol text NOT NULL UNIQUE,
  display_name text NOT NULL,
  asset_class text,
  price_precision integer,
  enabled boolean NOT NULL DEFAULT true,
  metadata_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_snapshots (
  id text PRIMARY KEY,
  timestamp timestamptz NOT NULL,
  account_type text NOT NULL,
  equity text,
  cash text,
  available_cash text,
  invested text,
  unrealized_pnl text,
  realized_daily_pnl text,
  open_position_count integer,
  raw_payload_json jsonb
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  request_id text,
  instrument_id text,
  payload_json jsonb
);
