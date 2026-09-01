-- Milestone 3: confirmed pivots, price zones, and regime snapshots.

CREATE TABLE IF NOT EXISTS pivots (
  id text PRIMARY KEY,
  instrument_id text NOT NULL,
  timeframe text NOT NULL,
  open_time_utc timestamptz NOT NULL,
  type text NOT NULL,
  price text NOT NULL,
  left_bars integer NOT NULL,
  right_bars integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pivots_instrument_tf_open_type_idx
  ON pivots (instrument_id, timeframe, open_time_utc, type);

CREATE TABLE IF NOT EXISTS price_zones (
  id text PRIMARY KEY,
  instrument_id text NOT NULL,
  timeframe text NOT NULL,
  type text NOT NULL,
  source text NOT NULL,
  lower_bound text NOT NULL,
  upper_bound text NOT NULL,
  midpoint text NOT NULL,
  strength_score integer NOT NULL,
  touch_count integer NOT NULL,
  last_touched_at timestamptz,
  status text NOT NULL,
  metadata_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_regimes (
  id text PRIMARY KEY,
  instrument_id text NOT NULL,
  timeframe text NOT NULL,
  timestamp timestamptz NOT NULL,
  trend text NOT NULL,
  structure text NOT NULL,
  volatility text NOT NULL,
  location text NOT NULL,
  confidence integer NOT NULL,
  evidence_json jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS market_regimes_instrument_tf_ts_idx
  ON market_regimes (instrument_id, timeframe, timestamp);
