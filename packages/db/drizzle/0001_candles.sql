-- Milestone 2: UTC candles and indicator snapshots.

CREATE TABLE IF NOT EXISTS candles (
  id text PRIMARY KEY,
  instrument_id text NOT NULL,
  timeframe text NOT NULL,
  open_time_utc timestamptz NOT NULL,
  close_time_utc timestamptz NOT NULL,
  open text NOT NULL,
  high text NOT NULL,
  low text NOT NULL,
  close text NOT NULL,
  volume text,
  source text NOT NULL,
  is_final boolean NOT NULL,
  revision integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS candles_instrument_tf_open_idx
  ON candles (instrument_id, timeframe, open_time_utc);

CREATE TABLE IF NOT EXISTS indicator_snapshots (
  id text PRIMARY KEY,
  instrument_id text NOT NULL,
  timeframe text NOT NULL,
  candle_open_time timestamptz NOT NULL,
  rsi14 text,
  atr14 text,
  ema20 text,
  ema50 text,
  ema200 text,
  bb_basis20 text,
  bb_upper20x2 text,
  bb_lower20x2 text,
  bb_width text,
  true_range text,
  rolling_volatility text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS indicator_snapshots_instrument_tf_open_idx
  ON indicator_snapshots (instrument_id, timeframe, candle_open_time);
