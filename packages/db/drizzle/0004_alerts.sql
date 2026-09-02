-- Milestone 5: in-app alerts and single-row settings.

CREATE TABLE IF NOT EXISTS alerts (
  id text PRIMARY KEY,
  type text NOT NULL,
  instrument_id text NOT NULL,
  symbol text NOT NULL,
  signal_id text,
  zone_id text,
  title text NOT NULL,
  body text NOT NULL,
  score integer,
  direction text,
  state text,
  dedupe_key text NOT NULL,
  channels_json jsonb NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS alerts_dedupe_key_idx ON alerts (dedupe_key);

CREATE TABLE IF NOT EXISTS app_settings (
  id text PRIMARY KEY,
  alerts_json jsonb NOT NULL,
  risk_json jsonb NOT NULL,
  markets_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
