-- Milestone 8: backtest runs and replay sessions.

CREATE TABLE IF NOT EXISTS backtest_runs (
  id text PRIMARY KEY,
  kind text NOT NULL,
  symbol text NOT NULL,
  strategy_key text,
  range_from timestamptz,
  range_to timestamptz,
  costs_json jsonb,
  walk_forward_mode text NOT NULL,
  status text NOT NULL,
  empty_reason text,
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
