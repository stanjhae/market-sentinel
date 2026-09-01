import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const instruments = pgTable(
  "instruments",
  {
    id: text("id").primaryKey(),
    etoroInstrumentId: integer("etoro_instrument_id"),
    canonicalSymbol: text("canonical_symbol").notNull(),
    displayName: text("display_name").notNull(),
    assetClass: text("asset_class"),
    pricePrecision: integer("price_precision"),
    enabled: boolean("enabled").notNull().default(true),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("instruments_canonical_symbol_idx").on(table.canonicalSymbol)],
);

export const accountSnapshots = pgTable("account_snapshots", {
  id: text("id").primaryKey(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  accountType: text("account_type").notNull(),
  equity: text("equity"),
  cash: text("cash"),
  availableCash: text("available_cash"),
  invested: text("invested"),
  unrealizedPnl: text("unrealized_pnl"),
  realizedDailyPnl: text("realized_daily_pnl"),
  openPositionCount: integer("open_position_count"),
  rawPayloadJson: jsonb("raw_payload_json"),
});

export const candles = pgTable(
  "candles",
  {
    id: text("id").primaryKey(),
    instrumentId: text("instrument_id").notNull(),
    timeframe: text("timeframe").notNull(),
    openTimeUtc: timestamp("open_time_utc", { withTimezone: true }).notNull(),
    closeTimeUtc: timestamp("close_time_utc", { withTimezone: true }).notNull(),
    open: text("open").notNull(),
    high: text("high").notNull(),
    low: text("low").notNull(),
    close: text("close").notNull(),
    volume: text("volume"),
    source: text("source").notNull(),
    isFinal: boolean("is_final").notNull(),
    revision: integer("revision").notNull().default(0),
  },
  (table) => [uniqueIndex("candles_instrument_tf_open_idx").on(table.instrumentId, table.timeframe, table.openTimeUtc)],
);

export const indicatorSnapshots = pgTable(
  "indicator_snapshots",
  {
    id: text("id").primaryKey(),
    instrumentId: text("instrument_id").notNull(),
    timeframe: text("timeframe").notNull(),
    candleOpenTime: timestamp("candle_open_time", { withTimezone: true }).notNull(),
    rsi14: text("rsi14"),
    atr14: text("atr14"),
    ema20: text("ema20"),
    ema50: text("ema50"),
    ema200: text("ema200"),
    bbBasis20: text("bb_basis20"),
    bbUpper20x2: text("bb_upper20x2"),
    bbLower20x2: text("bb_lower20x2"),
    bbWidth: text("bb_width"),
    trueRange: text("true_range"),
    rollingVolatility: text("rolling_volatility"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("indicator_snapshots_instrument_tf_open_idx").on(
      table.instrumentId,
      table.timeframe,
      table.candleOpenTime,
    ),
  ],
);

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  eventType: text("event_type").notNull(),
  requestId: text("request_id"),
  instrumentId: text("instrument_id"),
  payloadJson: jsonb("payload_json"),
});

export const pivots = pgTable(
  "pivots",
  {
    id: text("id").primaryKey(),
    instrumentId: text("instrument_id").notNull(),
    timeframe: text("timeframe").notNull(),
    openTimeUtc: timestamp("open_time_utc", { withTimezone: true }).notNull(),
    type: text("type").notNull(),
    price: text("price").notNull(),
    leftBars: integer("left_bars").notNull(),
    rightBars: integer("right_bars").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("pivots_instrument_tf_open_type_idx").on(table.instrumentId, table.timeframe, table.openTimeUtc, table.type)],
);

export const priceZones = pgTable("price_zones", {
  id: text("id").primaryKey(),
  instrumentId: text("instrument_id").notNull(),
  timeframe: text("timeframe").notNull(),
  type: text("type").notNull(),
  source: text("source").notNull(),
  lowerBound: text("lower_bound").notNull(),
  upperBound: text("upper_bound").notNull(),
  midpoint: text("midpoint").notNull(),
  strengthScore: integer("strength_score").notNull(),
  touchCount: integer("touch_count").notNull(),
  lastTouchedAt: timestamp("last_touched_at", { withTimezone: true }),
  status: text("status").notNull(),
  metadataJson: jsonb("metadata_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const marketRegimes = pgTable(
  "market_regimes",
  {
    id: text("id").primaryKey(),
    instrumentId: text("instrument_id").notNull(),
    timeframe: text("timeframe").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    trend: text("trend").notNull(),
    structure: text("structure").notNull(),
    volatility: text("volatility").notNull(),
    location: text("location").notNull(),
    confidence: integer("confidence").notNull(),
    evidenceJson: jsonb("evidence_json"),
  },
  (table) => [uniqueIndex("market_regimes_instrument_tf_ts_idx").on(table.instrumentId, table.timeframe, table.timestamp)],
);

export const signals = pgTable(
  "signals",
  {
    id: text("id").primaryKey(),
    instrumentId: text("instrument_id").notNull(),
    symbol: text("symbol").notNull(),
    strategyKey: text("strategy_key").notNull(),
    strategyVersion: text("strategy_version").notNull(),
    direction: text("direction").notNull(),
    state: text("state").notNull(),
    triggerTimeframe: text("trigger_timeframe").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    watchingAt: timestamp("watching_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    tradePlannedAt: timestamp("trade_planned_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    score: integer("score").notNull(),
    confidenceLabel: text("confidence_label").notNull(),
    entryZoneLow: text("entry_zone_low"),
    entryZoneHigh: text("entry_zone_high"),
    invalidationPrice: text("invalidation_price"),
    target1: text("target1"),
    target2: text("target2"),
    target3: text("target3"),
    riskRewardToT1: text("risk_reward_to_t1"),
    riskRewardToT2: text("risk_reward_to_t2"),
    lastEvaluatedOpenTimeUtc: timestamp("last_evaluated_open_time_utc", { withTimezone: true }).notNull(),
    evidenceJson: jsonb("evidence_json"),
    snapshotJson: jsonb("snapshot_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("signals_open_identity_idx")
      .on(table.instrumentId, table.strategyKey, table.direction)
      .where(sql`${table.state} not in ('INVALIDATED', 'EXPIRED', 'DISMISSED', 'CLOSED')`),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    instrumentId: text("instrument_id").notNull(),
    symbol: text("symbol").notNull(),
    signalId: text("signal_id"),
    zoneId: text("zone_id"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    score: integer("score"),
    direction: text("direction"),
    state: text("state"),
    dedupeKey: text("dedupe_key").notNull(),
    channelsJson: jsonb("channels_json").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("alerts_dedupe_key_idx").on(table.dedupeKey)],
);

export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey(),
  alertsJson: jsonb("alerts_json").notNull(),
  riskJson: jsonb("risk_json").notNull(),
  marketsJson: jsonb("markets_json").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
