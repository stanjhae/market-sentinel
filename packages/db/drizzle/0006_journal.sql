-- Milestone 7: journal entries, MAE/MFE, and signal ENTERED/CLOSED timestamps.

ALTER TABLE signals ADD COLUMN IF NOT EXISTS entered_at timestamptz;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS closed_at timestamptz;

CREATE TABLE IF NOT EXISTS journal_entries (
  id text PRIMARY KEY,
  etoro_position_id text NOT NULL,
  broker_trade_id text,
  trade_plan_id text,
  signal_id text,
  setup_key text,
  match_status text NOT NULL,
  match_locked boolean NOT NULL DEFAULT false,
  symbol text,
  instrument_id integer,
  direction text NOT NULL,
  opened_at timestamptz,
  closed_at timestamptz,
  open_price text,
  close_price text,
  units text,
  realized_pnl text,
  fees text,
  thesis_text text,
  pre_trade_emotion text,
  post_trade_emotion text,
  followed_plan boolean,
  rule_breaks_json jsonb,
  mae_usd text,
  mae_r text,
  mfe_usd text,
  mfe_r text,
  result_r text,
  notes text,
  screenshot_url text,
  tags_json jsonb,
  aligned_with_trend boolean,
  snapshot_json jsonb,
  evidence_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_etoro_position_idx ON journal_entries (etoro_position_id);
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_trade_plan_idx ON journal_entries (trade_plan_id) WHERE trade_plan_id IS NOT NULL;
