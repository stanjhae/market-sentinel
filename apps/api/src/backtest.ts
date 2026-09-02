import type {
  BacktestRunDto,
  BacktestRunResponse,
  BacktestTradeDto,
  BacktestTradesResponse,
  CandleDto,
  CreateBacktest,
  CreateReplaySession,
  IndicatorSnapshotDto,
  PaperTradeRequest,
  PriceZoneDto,
  ReplayFrameResponse,
} from "@market-sentinel/contracts";
import { createBacktestSchema, createReplaySessionSchema, paperTradeSchema } from "@market-sentinel/contracts";
import { backtestRuns, candles, instruments, type Database } from "@market-sentinel/db";
import { BACKTEST_DEFAULTS, TIMEFRAME_MS, parseWatchlistSymbol, type Timeframe, type WalkForwardMode } from "@market-sentinel/domain";
import {
  metricsFromTrades,
  paperFillAt,
  resolveCosts,
  runEventLoop,
  runWalkForward,
  selectFinal15m,
  simulateFills,
  type BacktestCosts,
  type InputCandle,
  type ReplayFrame,
  type SimulatedTrade,
} from "@market-sentinel/backtest";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const BACKTEST_CANDLE_LIMIT = 20_000;

type StoredIndicators = {
  rsi14: string | null;
  atr14: string | null;
  ema20: string | null;
  ema50: string | null;
  ema200: string | null;
  bbBasis20: string | null;
  bbUpper20x2: string | null;
  bbLower20x2: string | null;
  bbWidth: string | null;
  trueRange: string | null;
  rollingVolatility: string | null;
};

type StoredSignal = {
  id: string;
  strategyKey: string;
  strategyVersion: string;
  direction: ReplayFrame["signals"][number]["direction"];
  state: string;
  score: number;
  confirmedAt: string | null;
  entryZoneLow: string | null;
  entryZoneHigh: string | null;
  invalidationPrice: string | null;
  target1: string | null;
};

type StoredZone = {
  id: string;
  instrumentId: string;
  timeframe: Timeframe;
  type: PriceZoneDto["type"];
  source: PriceZoneDto["source"];
  lowerBound: string;
  upperBound: string;
  midpoint: string;
  strengthScore: number;
  touchCount: number;
  lastTouchedAt: string | null;
  status: PriceZoneDto["status"];
};

type StoredFrame = {
  index: number;
  barIndex: number;
  openTimeUtc: string;
  closeTimeUtc: string;
  lastFinalClose: string;
  signals: StoredSignal[];
  zones: StoredZone[];
  indicators: Partial<Record<Timeframe, StoredIndicators>>;
};

type StoredResult = {
  trades: SimulatedTrade[];
  paperTrades?: SimulatedTrade[];
  metrics: ReturnType<typeof metricsFromTrades>;
  windows: Array<{
    kind: "in-sample" | "out-of-sample";
    from: string;
    to: string;
    metrics: ReturnType<typeof metricsFromTrades>;
  }>;
  frames: StoredFrame[];
  bars: InputCandle[];
  warmupBars: number;
  barCount: number;
  emptyReason: string | null;
};

function toInput(args: { row: typeof candles.$inferSelect; symbol: string }): InputCandle {
  return {
    instrumentId: args.row.instrumentId,
    symbol: args.symbol,
    timeframe: args.row.timeframe as Timeframe,
    openTimeUtc: args.row.openTimeUtc,
    closeTimeUtc: args.row.closeTimeUtc,
    open: args.row.open,
    high: args.row.high,
    low: args.row.low,
    close: args.row.close,
    isFinal: args.row.isFinal,
  };
}

function toTradeDto(args: { trade: SimulatedTrade }): BacktestTradeDto {
  return {
    id: args.trade.id,
    strategyKey: args.trade.strategyKey,
    strategyVersion: args.trade.strategyVersion,
    direction: args.trade.direction,
    status: args.trade.status,
    unfillableReason: args.trade.unfillableReason,
    openedAt: args.trade.openedAt?.toISOString() ?? null,
    closedAt: args.trade.closedAt?.toISOString() ?? null,
    entryPrice: args.trade.entryPrice,
    exitPrice: args.trade.exitPrice,
    realizedPnl: args.trade.realizedPnl,
    fees: args.trade.fees,
    resultR: args.trade.resultR,
    maeUsd: args.trade.maeUsd,
    mfeUsd: args.trade.mfeUsd,
    exitReason: args.trade.exitReason,
  };
}

function reviveCandle(args: { candle: InputCandle }): InputCandle {
  return {
    ...args.candle,
    openTimeUtc: new Date(args.candle.openTimeUtc),
    closeTimeUtc: new Date(args.candle.closeTimeUtc),
  };
}

function reviveTrade(args: { trade: SimulatedTrade }): SimulatedTrade {
  return {
    ...args.trade,
    openedAt: args.trade.openedAt ? new Date(args.trade.openedAt) : null,
    closedAt: args.trade.closedAt ? new Date(args.trade.closedAt) : null,
  };
}

function compactIndicators(args: { values: ReplayFrame["indicators"][Timeframe] | undefined }): StoredIndicators | undefined {
  if (!args.values) {
    return undefined;
  }
  return {
    rsi14: args.values.rsi14,
    atr14: args.values.atr14,
    ema20: args.values.ema20,
    ema50: args.values.ema50,
    ema200: args.values.ema200,
    bbBasis20: args.values.bbBasis20,
    bbUpper20x2: args.values.bbUpper20x2,
    bbLower20x2: args.values.bbLower20x2,
    bbWidth: args.values.bbWidth,
    trueRange: args.values.trueRange,
    rollingVolatility: args.values.rollingVolatility,
  };
}

function compactFrame(args: { frame: ReplayFrame }): StoredFrame {
  return {
    index: args.frame.index,
    barIndex: args.frame.barIndex,
    openTimeUtc: args.frame.openTimeUtc.toISOString(),
    closeTimeUtc: args.frame.closeTimeUtc.toISOString(),
    lastFinalClose: args.frame.lastFinalClose,
    signals: args.frame.signals.map((signal) => ({
      id: signal.id,
      strategyKey: signal.strategyKey,
      strategyVersion: signal.strategyVersion,
      direction: signal.direction,
      state: signal.state,
      score: signal.score,
      confirmedAt: signal.confirmedAt ? signal.confirmedAt.toISOString() : null,
      entryZoneLow: signal.entryZoneLow,
      entryZoneHigh: signal.entryZoneHigh,
      invalidationPrice: signal.invalidationPrice,
      target1: signal.target1,
    })),
    zones: args.frame.zones.map((zone, zoneIndex) => ({
      id: zone.id ?? `zone-${zone.timeframe}-${zone.type}-${zone.lowerBound}-${zoneIndex}`,
      instrumentId: zone.instrumentId,
      timeframe: zone.timeframe,
      type: zone.type,
      source: zone.source,
      lowerBound: zone.lowerBound,
      upperBound: zone.upperBound,
      midpoint: zone.midpoint,
      strengthScore: zone.strengthScore,
      touchCount: zone.touchCount,
      lastTouchedAt: zone.lastTouchedAt ? new Date(zone.lastTouchedAt).toISOString() : null,
      status: zone.status,
    })),
    indicators: {
      "15m": compactIndicators({ values: args.frame.indicators["15m"] }),
      "1h": compactIndicators({ values: args.frame.indicators["1h"] }),
      "4h": compactIndicators({ values: args.frame.indicators["4h"] }),
    },
  };
}

function emptyStoredResult(args: { emptyReason: string; warmupBars?: number }): StoredResult {
  return {
    trades: [],
    paperTrades: [],
    metrics: metricsFromTrades({ trades: [], setupCount: 0 }),
    windows: [],
    frames: [],
    bars: [],
    warmupBars: args.warmupBars ?? BACKTEST_DEFAULTS.indicatorLookback,
    barCount: 0,
    emptyReason: args.emptyReason,
  };
}

export function parseCreateBacktest(args: { body: unknown }): { ok: true; value: CreateBacktest } | { ok: false } {
  const parsed = createBacktestSchema.safeParse(args.body);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

export function parseCreateReplay(args: { body: unknown }): { ok: true; value: CreateReplaySession } | { ok: false } {
  const parsed = createReplaySessionSchema.safeParse(args.body);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

export function parsePaperTrade(args: { body: unknown }): { ok: true; value: PaperTradeRequest } | { ok: false } {
  const parsed = paperTradeSchema.safeParse(args.body);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

export function emptyBacktestRun(): BacktestRunResponse {
  return { available: false, run: null };
}

export function emptyBacktestTrades(): BacktestTradesResponse {
  return { available: false, trades: [] };
}

export function emptyReplayFrame(args: { sessionId: string; timeframe: Timeframe }): ReplayFrameResponse {
  return {
    available: false,
    empty: true,
    emptyReason: "session-missing",
    sessionId: args.sessionId,
    index: 0,
    barCount: 0,
    timeframe: args.timeframe,
    openTimeUtc: null,
    candles: [],
    zones: [],
    indicators: null,
    signals: [],
    paperTrades: [],
  };
}

async function loadInstrumentCandles(args: {
  db: Database;
  symbol: string;
  from?: Date;
  to?: Date;
  includeWarmup?: boolean;
}): Promise<{ instrumentId: string; candles: InputCandle[] } | null> {
  const symbol = parseWatchlistSymbol({ value: args.symbol });
  if (!symbol) {
    return null;
  }
  const instrument = await args.db.select().from(instruments).where(eq(instruments.canonicalSymbol, symbol)).limit(1);
  const row = instrument[0];
  if (!row) {
    return null;
  }
  const loadFrom =
    args.from && args.includeWarmup
      ? new Date(args.from.getTime() - BACKTEST_DEFAULTS.structureLookback * TIMEFRAME_MS["15m"])
      : args.from;
  const filters = [
    eq(candles.instrumentId, row.id),
    eq(candles.isFinal, true),
    loadFrom ? gte(candles.openTimeUtc, loadFrom) : undefined,
    args.to ? lte(candles.openTimeUtc, args.to) : undefined,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));
  const rows = await args.db
    .select()
    .from(candles)
    .where(and(...filters))
    .orderBy(desc(candles.openTimeUtc))
    .limit(BACKTEST_CANDLE_LIMIT);
  return {
    instrumentId: row.id,
    candles: rows
      .slice()
      .reverse()
      .map((item) => toInput({ row: item, symbol })),
  };
}

function toRunDto(args: {
  id: string;
  kind: "backtest" | "replay";
  symbol: string;
  strategyKey: string | null;
  from: Date | null;
  to: Date | null;
  walkForwardMode: WalkForwardMode;
  status: "completed" | "empty" | "error";
  emptyReason: string | null;
  createdAt: Date;
  result: StoredResult | null;
}): BacktestRunDto {
  return {
    id: args.id,
    kind: args.kind,
    symbol: args.symbol,
    strategyKey: args.strategyKey,
    from: args.from?.toISOString() ?? null,
    to: args.to?.toISOString() ?? null,
    walkForwardMode: args.walkForwardMode,
    status: args.status,
    emptyReason: args.emptyReason,
    warmupBars: args.result?.warmupBars ?? 0,
    barCount: args.result?.barCount ?? 0,
    metrics: args.result?.metrics ?? null,
    windows: args.result?.windows ?? [],
    createdAt: args.createdAt.toISOString(),
  };
}

function higherFromLoaded(args: { candles: InputCandle[] }): Partial<Record<Timeframe, InputCandle[]>> {
  const hourly = args.candles.filter((candle) => candle.timeframe === "1h");
  const fourHour = args.candles.filter((candle) => candle.timeframe === "4h");
  return {
    ...(hourly.length > 0 ? { "1h": hourly } : {}),
    ...(fourHour.length > 0 ? { "4h": fourHour } : {}),
  };
}

export async function createBacktestRun(args: {
  db: Database;
  body: CreateBacktest | CreateReplaySession;
  kind?: "backtest" | "replay";
}): Promise<BacktestRunResponse> {
  const strategyKey = "strategyKey" in args.body ? args.body.strategyKey : undefined;
  const walkForwardRequested = "walkForwardMode" in args.body ? args.body.walkForwardMode : undefined;
  const requestedCosts = "costs" in args.body ? args.body.costs : undefined;
  const requestedFrom = args.body.from ? new Date(args.body.from) : undefined;
  const requestedTo = args.body.to ? new Date(args.body.to) : undefined;
  const loaded = await loadInstrumentCandles({
    db: args.db,
    symbol: args.body.symbol,
    from: requestedFrom,
    to: requestedTo,
    includeWarmup: true,
  });
  const id = randomUUID();
  const createdAt = new Date();
  const kind = args.kind ?? "backtest";
  const walkForwardMode = (walkForwardRequested ?? (kind === "replay" ? "none" : "split")) as WalkForwardMode;
  const persistEmpty = async (argsEmpty: { emptyReason: string }) => {
    const result = emptyStoredResult({ emptyReason: argsEmpty.emptyReason });
    await args.db.insert(backtestRuns).values({
      id,
      kind,
      symbol: args.body.symbol,
      strategyKey: strategyKey ?? null,
      rangeFrom: requestedFrom ?? null,
      rangeTo: requestedTo ?? null,
      costsJson: resolveCosts({ costs: requestedCosts }),
      walkForwardMode,
      status: "empty",
      emptyReason: argsEmpty.emptyReason,
      resultJson: result,
    });
    return {
      available: true,
      run: toRunDto({
        id,
        kind,
        symbol: args.body.symbol,
        strategyKey: strategyKey ?? null,
        from: requestedFrom ?? null,
        to: requestedTo ?? null,
        walkForwardMode,
        status: "empty",
        emptyReason: argsEmpty.emptyReason,
        createdAt,
        result,
      }),
    };
  };
  if (!loaded || loaded.candles.length === 0) {
    return persistEmpty({ emptyReason: "no-final-candles" });
  }
  const costs = resolveCosts({ costs: requestedCosts });
  const bars15m = selectFinal15m({ candles: loaded.candles });
  const signalFromIndex = requestedFrom
    ? bars15m.findIndex((bar) => bar.openTimeUtc.getTime() >= requestedFrom.getTime())
    : 0;
  if (requestedFrom && signalFromIndex < 0) {
    return persistEmpty({ emptyReason: "no-final-candles" });
  }
  const higher = higherFromLoaded({ candles: loaded.candles });
  const loop = await runEventLoop({
    candles: loaded.candles,
    higher,
    symbol: args.body.symbol,
    signalFromIndex: signalFromIndex < 0 ? 0 : signalFromIndex,
    yieldEvery: BACKTEST_DEFAULTS.yieldEveryBars,
    keepSnapshots: false,
    skipWarmupStructure: true,
  });
  if (loop.emptyReason) {
    return persistEmpty({ emptyReason: loop.emptyReason });
  }
  const signals = strategyKey ? loop.signals.filter((signal) => signal.strategyKey === strategyKey) : loop.signals;
  const trades = simulateFills({ signals, bars15m, costs });
  const setups = new Set(signals.filter((signal) => signal.confirmedAt).map((signal) => `${signal.strategyKey}@${signal.strategyVersion}`));
  const windowFrom = requestedFrom ?? bars15m[loop.warmupBars]?.openTimeUtc ?? bars15m[0]!.openTimeUtc;
  const windowTo = requestedTo ?? bars15m[bars15m.length - 1]!.closeTimeUtc;
  const windows =
    kind === "backtest"
      ? (
          await runWalkForward({
            candles: loaded.candles,
            mode: walkForwardMode,
            costs,
            symbol: args.body.symbol,
            from: windowFrom,
            to: windowTo,
            loop,
            higher,
          })
        ).map((window) => ({
          kind: window.kind,
          from: window.from.toISOString(),
          to: window.to.toISOString(),
          metrics: window.metrics,
        }))
      : [];
  const result: StoredResult = {
    trades,
    paperTrades: [],
    metrics: metricsFromTrades({ trades, setupCount: setups.size }),
    windows,
    frames: kind === "replay" ? loop.frames.map((frame) => compactFrame({ frame })) : [],
    bars: loaded.candles,
    warmupBars: loop.warmupBars,
    barCount: loop.frames.length,
    emptyReason: loop.emptyReason,
  };
  const status = loop.emptyReason ? "empty" : "completed";
  await args.db.insert(backtestRuns).values({
    id,
    kind,
    symbol: args.body.symbol,
    strategyKey: strategyKey ?? null,
    rangeFrom: requestedFrom ?? null,
    rangeTo: requestedTo ?? null,
    costsJson: costs,
    walkForwardMode,
    status,
    emptyReason: loop.emptyReason,
    resultJson: result,
  });
  return {
    available: true,
    run: toRunDto({
      id,
      kind,
      symbol: args.body.symbol,
      strategyKey: strategyKey ?? null,
      from: requestedFrom ?? null,
      to: requestedTo ?? null,
      walkForwardMode,
      status,
      emptyReason: loop.emptyReason,
      createdAt,
      result,
    }),
  };
}

export async function readBacktestRun(args: { db: Database; id: string }): Promise<BacktestRunResponse> {
  const rows = await args.db.select().from(backtestRuns).where(eq(backtestRuns.id, args.id)).limit(1);
  const row = rows[0];
  if (!row) {
    return emptyBacktestRun();
  }
  return {
    available: true,
    run: toRunDto({
      id: row.id,
      kind: row.kind as "backtest" | "replay",
      symbol: row.symbol,
      strategyKey: row.strategyKey,
      from: row.rangeFrom,
      to: row.rangeTo,
      walkForwardMode: row.walkForwardMode as WalkForwardMode,
      status: row.status as "completed" | "empty" | "error",
      emptyReason: row.emptyReason,
      createdAt: row.createdAt,
      result: row.resultJson as StoredResult | null,
    }),
  };
}

export async function readBacktestTrades(args: { db: Database; id: string }): Promise<BacktestTradesResponse> {
  const rows = await args.db.select().from(backtestRuns).where(eq(backtestRuns.id, args.id)).limit(1);
  const row = rows[0];
  if (!row) {
    return emptyBacktestTrades();
  }
  const result = row.resultJson as StoredResult | null;
  return { available: true, trades: (result?.trades ?? []).map((trade) => toTradeDto({ trade: reviveTrade({ trade }) })) };
}

function zoneDto(args: { zone: StoredZone; symbol: string; index: number }): PriceZoneDto {
  return {
    id: args.zone.id || `zone-${args.zone.timeframe}-${args.index}`,
    instrumentId: args.zone.instrumentId,
    symbol: args.symbol,
    timeframe: args.zone.timeframe,
    type: args.zone.type,
    source: args.zone.source,
    lowerBound: args.zone.lowerBound,
    upperBound: args.zone.upperBound,
    midpoint: args.zone.midpoint,
    strengthScore: args.zone.strengthScore,
    touchCount: args.zone.touchCount,
    lastTouchedAt: args.zone.lastTouchedAt,
    status: args.zone.status,
    metadataJson: {},
  };
}

function candleDto(args: { candle: InputCandle }): CandleDto {
  return {
    instrumentId: args.candle.instrumentId,
    symbol: args.candle.symbol,
    timeframe: args.candle.timeframe,
    openTimeUtc: new Date(args.candle.openTimeUtc).toISOString(),
    closeTimeUtc: new Date(args.candle.closeTimeUtc).toISOString(),
    open: args.candle.open,
    high: args.candle.high,
    low: args.candle.low,
    close: args.candle.close,
    volume: null,
    source: "ETORO_REST",
    isFinal: args.candle.isFinal,
    revision: 0,
  };
}

function indicatorDto(args: {
  values: StoredIndicators | undefined;
  candle: InputCandle | undefined;
  timeframe: Timeframe;
}): IndicatorSnapshotDto | null {
  if (!args.values || !args.candle) {
    return null;
  }
  return {
    instrumentId: args.candle.instrumentId,
    timeframe: args.timeframe,
    candleOpenTime: new Date(args.candle.openTimeUtc).toISOString(),
    rsi14: args.values.rsi14,
    atr14: args.values.atr14,
    ema20: args.values.ema20,
    ema50: args.values.ema50,
    ema200: args.values.ema200,
    bbBasis20: args.values.bbBasis20,
    bbUpper20x2: args.values.bbUpper20x2,
    bbLower20x2: args.values.bbLower20x2,
    bbWidth: args.values.bbWidth,
    trueRange: args.values.trueRange,
    rollingVolatility: args.values.rollingVolatility,
  };
}

export async function readReplayFrame(args: {
  db: Database;
  id: string;
  index: number;
  timeframe: Timeframe;
}): Promise<ReplayFrameResponse> {
  const rows = await args.db.select().from(backtestRuns).where(eq(backtestRuns.id, args.id)).limit(1);
  const row = rows[0];
  if (!row) {
    return emptyReplayFrame({ sessionId: args.id, timeframe: args.timeframe });
  }
  const result = row.resultJson as StoredResult | null;
  if (!result || result.frames.length === 0) {
    return {
      ...emptyReplayFrame({ sessionId: args.id, timeframe: args.timeframe }),
      available: true,
      emptyReason: result?.emptyReason ?? "insufficient-history",
    };
  }
  const maxIndex = result.frames.length - 1;
  const index = Math.min(Math.max(0, args.index), maxIndex);
  const frame = result.frames[index]!;
  const asOf = new Date(frame.closeTimeUtc);
  const visible = result.bars
    .map((candle) => reviveCandle({ candle }))
    .filter((candle) => candle.timeframe === args.timeframe && candle.isFinal && candle.closeTimeUtc.getTime() <= asOf.getTime());
  const last = visible[visible.length - 1];
  return {
    available: true,
    empty: false,
    emptyReason: null,
    sessionId: row.id,
    index,
    barCount: result.frames.length,
    timeframe: args.timeframe,
    openTimeUtc: frame.openTimeUtc,
    candles: visible.map((candle) => candleDto({ candle })),
    zones: frame.zones
      .filter((zone) => zone.timeframe === args.timeframe)
      .map((zone, zoneIndex) => zoneDto({ zone, symbol: row.symbol, index: zoneIndex })),
    indicators: indicatorDto({ values: frame.indicators[args.timeframe], candle: last, timeframe: args.timeframe }),
    signals: frame.signals.map((signal) => ({
      id: signal.id,
      strategyKey: signal.strategyKey,
      strategyVersion: signal.strategyVersion,
      direction: signal.direction,
      state: signal.state,
      score: signal.score,
      confirmedAt: signal.confirmedAt,
      entryZoneLow: signal.entryZoneLow,
      entryZoneHigh: signal.entryZoneHigh,
      invalidationPrice: signal.invalidationPrice,
      target1: signal.target1,
    })),
    paperTrades: (result.paperTrades ?? []).map((trade) => toTradeDto({ trade: reviveTrade({ trade }) })),
  };
}

export async function addPaperTrade(args: {
  db: Database;
  id: string;
  index: number;
  body: PaperTradeRequest;
}): Promise<ReplayFrameResponse | { error: "not-found" }> {
  const rows = await args.db.select().from(backtestRuns).where(eq(backtestRuns.id, args.id)).limit(1);
  const row = rows[0];
  if (!row) {
    return { error: "not-found" };
  }
  const result = (row.resultJson as StoredResult | null) ?? emptyStoredResult({ emptyReason: "no-final-candles" });
  const bars15m = selectFinal15m({ candles: result.bars.map((candle) => reviveCandle({ candle })) });
  const costs = resolveCosts({ costs: (row.costsJson as Partial<BacktestCosts> | null) ?? undefined });
  const frame = result.frames[Math.min(Math.max(0, args.index), Math.max(0, result.frames.length - 1))];
  const barIndex = frame?.barIndex ?? result.warmupBars + args.index;
  const next = paperFillAt({
    direction: args.body.direction,
    stopLoss: args.body.stopLoss,
    target1: args.body.target1,
    bars15m,
    index: barIndex,
    costs,
    id: randomUUID(),
  });
  result.paperTrades = [...(result.paperTrades ?? []), next];
  await args.db.update(backtestRuns).set({ resultJson: result }).where(eq(backtestRuns.id, args.id));
  return readReplayFrame({ db: args.db, id: args.id, index: args.index, timeframe: "15m" });
}
