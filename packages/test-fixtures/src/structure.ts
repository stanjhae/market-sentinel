export type FixtureTimeframe = "15m" | "1h" | "4h";

export type FixtureBar = {
  instrumentId: string;
  timeframe: FixtureTimeframe;
  openTimeUtc: Date;
  high: string;
  low: string;
  open: string;
  close: string;
  isFinal: boolean;
};

export function structureBar(args: {
  index: number;
  high: string;
  low: string;
  open?: string;
  close?: string;
  isFinal?: boolean;
  timeframe?: FixtureTimeframe;
  instrumentId?: string;
  start?: Date;
}): FixtureBar {
  const timeframe = args.timeframe ?? "15m";
  const start = args.start ?? new Date("2026-09-01T00:00:00.000Z");
  const ms = timeframe === "15m" ? 15 * 60 * 1000 : timeframe === "1h" ? 60 * 60 * 1000 : 4 * 60 * 60 * 1000;
  const open = args.open ?? args.close ?? args.low;
  const close = args.close ?? args.high;
  return {
    instrumentId: args.instrumentId ?? "inst-1",
    timeframe,
    openTimeUtc: new Date(start.getTime() + args.index * ms),
    high: args.high,
    low: args.low,
    open,
    close,
    isFinal: args.isFinal ?? true,
  };
}

/** Isolated swing high at index 3 (100) with 3 bars on each side. */
export function swingHighFixture(args: { extraBars?: number; openLast?: boolean } = {}): FixtureBar[] {
  const highs = [90, 91, 92, 100, 93, 92, 91, ...(args.extraBars ? [90] : [])];
  return highs.map((high, index) =>
    structureBar({
      index,
      high: String(high),
      low: String(high - 5),
      close: String(high - 1),
      isFinal: args.openLast && index === highs.length - 1 ? false : true,
    }),
  );
}

/** Isolated peak 110, trough 80, peak 120, trough 90 — HH + HL after confirmation. */
export function bullishStructureFixture(): FixtureBar[] {
  const highs = [100, 101, 102, 110, 103, 102, 101, 102, 103, 104, 105, 106, 107, 120, 108, 107, 106, 105, 104, 103, 102, 101];
  const lows = [95, 96, 94, 97, 96, 95, 94, 93, 80, 93, 94, 95, 96, 98, 97, 96, 95, 94, 90, 94, 95, 96];
  return highs.map((high, index) =>
    structureBar({
      index,
      high: String(high),
      low: String(lows[index] ?? high - 8),
      close: String(high - 1),
    }),
  );
}

/** Two falling highs and two falling lows — LH + LL. */
export function bearishStructureFixture(): FixtureBar[] {
  const points = [
    { high: "120", low: "110" },
    { high: "119", low: "109" },
    { high: "118", low: "108" },
    { high: "130", low: "105" },
    { high: "116", low: "106" },
    { high: "115", low: "107" },
    { high: "114", low: "108" },
    { high: "112", low: "100" },
    { high: "111", low: "99" },
    { high: "110", low: "98" },
    { high: "118", low: "90" },
    { high: "108", low: "91" },
    { high: "107", low: "92" },
    { high: "106", low: "93" },
  ];
  return points.map((point, index) => structureBar({ index, high: point.high, low: point.low, close: point.low }));
}
