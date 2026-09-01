import { Decimal } from "decimal.js";
import { TIMEFRAME_MS, type Timeframe } from "./index.js";

export type CandleSource = "ETORO_REST" | "ETORO_STREAM_AGGREGATED";

export type Candle = {
  instrumentId: string;
  timeframe: Timeframe;
  openTimeUtc: Date;
  closeTimeUtc: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
  source: CandleSource;
  isFinal: boolean;
  revision: number;
};

export type CandleWriteAction = "insert" | "update" | "revise" | "ignore";

const MATERIAL_RELATIVE = new Decimal("0.000001");

export function candleOpenTimeUtc(args: { at: Date; timeframe: Timeframe }): Date {
  const size = TIMEFRAME_MS[args.timeframe];
  return new Date(Math.floor(args.at.getTime() / size) * size);
}

export function candleCloseTimeUtc(args: { openTimeUtc: Date; timeframe: Timeframe }): Date {
  return new Date(args.openTimeUtc.getTime() + TIMEFRAME_MS[args.timeframe]);
}

export function isCandleOpen(args: { closeTimeUtc: Date; now: Date }): boolean {
  return args.now.getTime() < args.closeTimeUtc.getTime();
}

export function tickPrice(args: {
  last: string | null;
  bid: string | null;
  ask: string | null;
}): string | null {
  if (args.last) {
    return new Decimal(args.last).toString();
  }
  if (args.bid && args.ask) {
    return new Decimal(args.bid).plus(args.ask).div(2).toString();
  }
  if (args.bid) {
    return new Decimal(args.bid).toString();
  }
  if (args.ask) {
    return new Decimal(args.ask).toString();
  }
  return null;
}

export function assertCandleInvariants(candle: Candle): void {
  const open = new Decimal(candle.open);
  const high = new Decimal(candle.high);
  const low = new Decimal(candle.low);
  const close = new Decimal(candle.close);
  if (high.lt(Decimal.max(open, close)) || low.gt(Decimal.min(open, close))) {
    throw new Error("candle OHLC invariant violated");
  }
  if (candle.closeTimeUtc.getTime() <= candle.openTimeUtc.getTime()) {
    throw new Error("candle close must be after open");
  }
}

export function materialOhlcDiscrepancy(args: { left: Candle; right: Candle }): boolean {
  return (["open", "high", "low", "close"] as const).some((key) => {
    const left = new Decimal(args.left[key]);
    const right = new Decimal(args.right[key]);
    const denom = Decimal.max(left.abs(), right.abs(), 1);
    return left.minus(right).abs().div(denom).gt(MATERIAL_RELATIVE);
  });
}

export function decideCandleWrite(args: {
  existing: Candle | null;
  incoming: Candle;
}): { action: CandleWriteAction; revision: number } {
  if (!args.existing) {
    return { action: "insert", revision: args.incoming.revision };
  }
  if (!args.existing.isFinal) {
    if (args.incoming.source === "ETORO_REST" && args.existing.source === "ETORO_STREAM_AGGREGATED") {
      return { action: "ignore", revision: args.existing.revision };
    }
    return { action: "update", revision: args.existing.revision };
  }
  if (!args.incoming.isFinal) {
    return { action: "ignore", revision: args.existing.revision };
  }
  if (args.incoming.source !== "ETORO_REST") {
    return { action: "ignore", revision: args.existing.revision };
  }
  if (materialOhlcDiscrepancy({ left: args.existing, right: args.incoming })) {
    return { action: "revise", revision: args.existing.revision + 1 };
  }
  return { action: "ignore", revision: args.existing.revision };
}

export function applyTickToCandle(args: {
  current: Candle | null;
  instrumentId: string;
  timeframe: Timeframe;
  price: string;
  at: Date;
}): { updated: Candle; closed: Candle | null } {
  const openTimeUtc = candleOpenTimeUtc({ at: args.at, timeframe: args.timeframe });
  const closeTimeUtc = candleCloseTimeUtc({ openTimeUtc, timeframe: args.timeframe });
  const price = new Decimal(args.price).toString();

  let closed: Candle | null = null;
  let current = args.current;

  if (current && current.openTimeUtc.getTime() !== openTimeUtc.getTime()) {
    if (!current.isFinal) {
      closed = { ...current, isFinal: true };
      assertCandleInvariants(closed);
    }
    current = null;
  }

  if (!current) {
    const opened: Candle = {
      instrumentId: args.instrumentId,
      timeframe: args.timeframe,
      openTimeUtc,
      closeTimeUtc,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: null,
      source: "ETORO_STREAM_AGGREGATED",
      isFinal: false,
      revision: 0,
    };
    assertCandleInvariants(opened);
    return { updated: opened, closed };
  }

  const updated: Candle = {
    ...current,
    high: Decimal.max(current.high, price).toString(),
    low: Decimal.min(current.low, price).toString(),
    close: price,
    source: "ETORO_STREAM_AGGREGATED",
    isFinal: false,
  };
  assertCandleInvariants(updated);
  return { updated, closed };
}

export class CandleBuilder {
  private current: Candle | null = null;

  constructor(private readonly args: { instrumentId: string; timeframe: Timeframe }) {}

  seed(args: { candle: Candle }): void {
    if (args.candle.isFinal) {
      return;
    }
    this.current = { ...args.candle };
  }

  mergeSeed(args: { candle: Candle }): void {
    if (args.candle.isFinal) {
      return;
    }
    if (!this.current) {
      this.current = { ...args.candle };
      return;
    }
    if (this.current.openTimeUtc.getTime() !== args.candle.openTimeUtc.getTime()) {
      return;
    }
    this.current = {
      ...this.current,
      high: Decimal.max(this.current.high, args.candle.high).toString(),
      low: Decimal.min(this.current.low, args.candle.low).toString(),
    };
  }

  getCurrent(): Candle | null {
    return this.current ? { ...this.current } : null;
  }

  applyTick(args: { price: string; at: Date }): { updated: Candle; closed: Candle | null } {
    const result = applyTickToCandle({
      current: this.current,
      instrumentId: this.args.instrumentId,
      timeframe: this.args.timeframe,
      price: args.price,
      at: args.at,
    });
    this.current = result.updated;
    return result;
  }
}
