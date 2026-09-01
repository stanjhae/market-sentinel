-- Milestone 4: versioned signals and state-machine persistence.

CREATE TABLE IF NOT EXISTS signals (
  id text PRIMARY KEY,
  instrument_id text NOT NULL,
  symbol text NOT NULL,
  strategy_key text NOT NULL,
  strategy_version text NOT NULL,
  direction text NOT NULL,
  state text NOT NULL,
  trigger_timeframe text NOT NULL,
  detected_at timestamptz NOT NULL,
  watching_at timestamptz,
  confirmed_at timestamptz,
  trade_planned_at timestamptz,
  invalidated_at timestamptz,
  expired_at timestamptz,
  dismissed_at timestamptz,
  score integer NOT NULL,
  confidence_label text NOT NULL,
  entry_zone_low text,
  entry_zone_high text,
  invalidation_price text,
  target1 text,
  target2 text,
  target3 text,
  risk_reward_to_t1 text,
  risk_reward_to_t2 text,
  last_evaluated_open_time_utc timestamptz NOT NULL,
  evidence_json jsonb,
  snapshot_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS signals_open_identity_idx
  ON signals (instrument_id, strategy_key, direction)
  WHERE state NOT IN ('INVALIDATED', 'EXPIRED', 'DISMISSED', 'CLOSED');
