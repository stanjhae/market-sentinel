-- At most one in-flight/filled/ambiguous open per plan, and close per position.

CREATE UNIQUE INDEX IF NOT EXISTS broker_orders_active_open_plan_idx
  ON broker_orders (trade_plan_id)
  WHERE action = 'open' AND status IN ('PENDING', 'FILLED', 'AMBIGUOUS') AND trade_plan_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS broker_orders_active_close_position_idx
  ON broker_orders (position_id)
  WHERE action = 'close' AND status IN ('PENDING', 'FILLED', 'AMBIGUOUS') AND position_id IS NOT NULL;
