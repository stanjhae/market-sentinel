-- Milestone 6: broker positions/trades, trade plans, risk session, news events.

CREATE TABLE IF NOT EXISTS broker_positions (
  id text PRIMARY KEY,
  etoro_position_id text NOT NULL,
  instrument_id integer NOT NULL,
  symbol text,
  direction text NOT NULL,
  opened_at timestamptz,
  open_price text,
  units text,
  invested_amount text,
  leverage text,
  stop_loss text,
  take_profit text,
  unrealized_pnl text,
  fees text,
  mirror_id integer NOT NULL DEFAULT 0,
  raw_payload_json jsonb,
  synced_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS broker_positions_etoro_id_idx ON broker_positions (etoro_position_id);

CREATE TABLE IF NOT EXISTS broker_trades (
  id text PRIMARY KEY,
  etoro_position_id text NOT NULL,
  etoro_order_id text,
  instrument_id integer NOT NULL,
  symbol text,
  direction text NOT NULL,
  opened_at timestamptz,
  closed_at timestamptz,
  open_price text,
  close_price text,
  units text,
  invested_amount text,
  leverage text,
  stop_loss text,
  take_profit text,
  realized_pnl text,
  fees text,
  source_account text NOT NULL,
  raw_broker_payload_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS broker_trades_etoro_account_idx ON broker_trades (etoro_position_id, source_account);

CREATE TABLE IF NOT EXISTS trade_plans (
  id text PRIMARY KEY,
  signal_id text NOT NULL,
  account_snapshot_id text,
  direction text NOT NULL,
  entry_type text NOT NULL,
  planned_entry text,
  stop_loss text,
  target1 text,
  target2 text,
  target3 text,
  risk_pct text,
  risk_amount_usd text,
  estimated_position_size text,
  expected_r text,
  gate_status text NOT NULL,
  block_reasons_json jsonb,
  checklist_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);

CREATE TABLE IF NOT EXISTS risk_state (
  id text PRIMARY KEY,
  consecutive_losses integer NOT NULL,
  last_loss_at timestamptz,
  cooldown_until timestamptz,
  manual_cooldown_until timestamptz,
  daily_pnl text NOT NULL,
  trading_status text NOT NULL,
  history_unavailable boolean NOT NULL DEFAULT false,
  last_sync_at timestamptz,
  last_sync_latency_ms integer,
  sync_error_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS economic_events (
  id text PRIMARY KEY,
  event_name text NOT NULL,
  currency text NOT NULL,
  impact text NOT NULL,
  scheduled_at_utc timestamptz NOT NULL,
  blackout_before_minutes integer NOT NULL,
  blackout_after_minutes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
