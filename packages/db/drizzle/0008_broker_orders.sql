-- Milestone 9: Demo execution order lifecycle.

CREATE TABLE IF NOT EXISTS broker_orders (
  id text PRIMARY KEY,
  trade_plan_id text,
  action text NOT NULL,
  status text NOT NULL,
  etoro_order_id text,
  reference_id text NOT NULL,
  instrument_id integer NOT NULL,
  amount text,
  position_id text,
  raw_request_json jsonb,
  raw_response_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS broker_orders_reference_idx ON broker_orders (reference_id);
