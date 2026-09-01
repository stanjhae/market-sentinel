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
