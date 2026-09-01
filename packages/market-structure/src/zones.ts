import type { Timeframe, ZoneType } from "@market-sentinel/domain";
import { distanceFromZoneInAtr } from "@market-sentinel/indicators";
import { Decimal } from "decimal.js";
import { STRUCTURE_DEFAULTS } from "./defaults.js";
import type { ConfirmedPivot, PriceZone, StructureBar } from "./types.js";

export function zoneMidpoint(args: { lowerBound: string; upperBound: string }): string {
  return new Decimal(args.lowerBound).plus(args.upperBound).div(2).toString();
}

export function zonesOverlap(args: { left: Pick<PriceZone, "lowerBound" | "upperBound">; right: Pick<PriceZone, "lowerBound" | "upperBound"> }): boolean {
  const leftLow = new Decimal(args.left.lowerBound);
  const leftHigh = new Decimal(args.left.upperBound);
  const rightLow = new Decimal(args.right.lowerBound);
  const rightHigh = new Decimal(args.right.upperBound);
  return leftLow.lte(rightHigh) && rightLow.lte(leftHigh);
}

export function closeBreaksZone(args: { close: string; zone: PriceZone; atr: string | null }): "above" | "below" | null {
  if (!args.atr || new Decimal(args.atr).eq(0) || args.zone.status === "EXPIRED") {
    return null;
  }
  const close = new Decimal(args.close);
  const penetration = new Decimal(args.atr).times(STRUCTURE_DEFAULTS.breakPenetrationAtr);
  if (close.gte(new Decimal(args.zone.upperBound).plus(penetration))) {
    return "above";
  }
  if (close.lte(new Decimal(args.zone.lowerBound).minus(penetration))) {
    return "below";
  }
  return null;
}

export function closeCrossesZone(args: {
  close: string;
  previousClose: string | null;
  zone: PriceZone;
  atr: string | null;
}): "above" | "below" | null {
  if (!args.previousClose) {
    return null;
  }
  const side = closeBreaksZone({ close: args.close, zone: args.zone, atr: args.atr });
  if (!side) {
    return null;
  }
  const previousSide = closeBreaksZone({ close: args.previousClose, zone: args.zone, atr: args.atr });
  return previousSide === side ? null : side;
}

export function wickTouchesZone(args: { candle: StructureBar; zone: PriceZone }): boolean {
  const high = new Decimal(args.candle.high);
  const low = new Decimal(args.candle.low);
  const lower = new Decimal(args.zone.lowerBound);
  const upper = new Decimal(args.zone.upperBound);
  return high.gte(lower) && low.lte(upper);
}

export function clusterAutoZones(args: {
  pivots: ConfirmedPivot[];
  atr: string | null;
  existingManual: PriceZone[];
  instrumentId: string;
  timeframe: Timeframe;
}): PriceZone[] {
  if (args.pivots.length === 0) {
    return [];
  }
  const threshold = args.atr ? new Decimal(args.atr).times(STRUCTURE_DEFAULTS.clusterAtrFraction) : new Decimal(0);
  const sorted = args.pivots.slice().sort((left, right) => new Decimal(left.price).cmp(right.price));
  const groups: ConfirmedPivot[][] = [];
  let current: ConfirmedPivot[] = [];
  for (const pivot of sorted) {
    const last = current[current.length - 1];
    if (!last || new Decimal(pivot.price).minus(last.price).abs().lte(threshold)) {
      current.push(pivot);
    } else {
      groups.push(current);
      current = [pivot];
    }
  }
  if (current.length > 0) {
    groups.push(current);
  }

  return groups.flatMap((group) => {
    const prices = group.map((item) => new Decimal(item.price));
    const lowerBound = Decimal.min(...prices).toString();
    const upperBound = Decimal.max(...prices).toString();
    const draft: PriceZone = {
      instrumentId: args.instrumentId,
      timeframe: args.timeframe,
      type: zoneTypeFromPivots({ pivots: group }),
      source: "AUTO_PIVOT",
      lowerBound,
      upperBound,
      midpoint: zoneMidpoint({ lowerBound, upperBound }),
      strengthScore: 20,
      touchCount: group.length,
      lastTouchedAt: latestPivotTime({ pivots: group }),
      status: "ACTIVE",
      metadataJson: {
        why: `${group.length} clustered ${group.every((item) => item.type === "HIGH") ? "high" : group.every((item) => item.type === "LOW") ? "low" : "mixed"} pivots`,
        pivotTimes: group.map((item) => item.openTimeUtc.toISOString()),
        pivotPrices: group.map((item) => item.price),
      },
    };
    const overlapsManual = args.existingManual.some((manual) => zonesOverlap({ left: draft, right: manual }));
    return overlapsManual ? [] : [draft];
  });
}

export function priorPeriodZones(args: {
  candles: StructureBar[];
  instrumentId: string;
  timeframe: Timeframe;
  now: Date;
}): PriceZone[] {
  const finals = args.candles.filter((candle) => candle.isFinal);
  const dayKey = utcDayKey({ at: new Date(args.now.getTime() - 24 * 60 * 60 * 1000) });
  const weekKey = utcWeekKey({ at: new Date(args.now.getTime() - 7 * 24 * 60 * 60 * 1000) });
  const dayBars = finals.filter((candle) => utcDayKey({ at: candle.openTimeUtc }) === dayKey);
  const weekStart = startOfUtcWeek({ at: new Date(args.now.getTime() - 7 * 24 * 60 * 60 * 1000) });
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekBars = finals.filter(
    (candle) => candle.openTimeUtc.getTime() >= weekStart.getTime() && candle.openTimeUtc.getTime() < weekEnd.getTime(),
  );
  return [
    ...rangeZones({
      bars: dayBars,
      instrumentId: args.instrumentId,
      timeframe: args.timeframe,
      source: "PRIOR_DAY",
      periodKey: dayKey,
    }),
    ...rangeZones({
      bars: weekBars,
      instrumentId: args.instrumentId,
      timeframe: args.timeframe,
      source: "PRIOR_WEEK",
      periodKey: weekKey,
    }),
  ];
}

export function applyZoneBreaks(args: {
  zones: PriceZone[];
  candles: StructureBar[];
  atr: string | null;
}): PriceZone[] {
  const finals = args.candles
    .filter((candle) => candle.isFinal)
    .slice()
    .sort((left, right) => left.openTimeUtc.getTime() - right.openTimeUtc.getTime());
  return args.zones.map((zone) => applyZoneBreaksToZone({ zone, candles: finals, atr: args.atr }));
}

export function expireIdleZones(args: { zones: PriceZone[]; lastOpenTime: Date; barMs: number }): PriceZone[] {
  const idleMs = STRUCTURE_DEFAULTS.expireIdleBars * args.barMs;
  return args.zones.map((zone) => {
    if (zone.source === "USER_MANUAL" || zone.status !== "ACTIVE") {
      return zone;
    }
    const last = zone.lastTouchedAt?.getTime() ?? 0;
    const idle = args.lastOpenTime.getTime() - last > idleMs;
    if (idle && zone.strengthScore < STRUCTURE_DEFAULTS.expireStrengthBelow) {
      return { ...zone, status: "EXPIRED" as const, metadataJson: { ...zone.metadataJson, lastReaction: "expired idle" } };
    }
    return zone;
  });
}

export function mergeAutoZones(args: { existing: PriceZone[]; incoming: PriceZone[] }): PriceZone[] {
  const manuals = args.existing.filter((zone) => zone.source === "USER_MANUAL");
  const kept = args.existing.filter((zone) => zone.source !== "USER_MANUAL" && zone.source !== "AUTO_PIVOT");
  const existingAuto = args.existing.filter((zone) => zone.source === "AUTO_PIVOT");
  const used = new Set<string>();
  const merged = args.incoming.map((incoming) => {
    const match = existingAuto.find((zone) => {
      const key = zone.id ?? `${zone.lowerBound}:${zone.upperBound}`;
      if (used.has(key)) {
        return false;
      }
      return zonesOverlap({ left: zone, right: incoming });
    });
    if (!match) {
      return incoming;
    }
    used.add(match.id ?? `${match.lowerBound}:${match.upperBound}`);
    const boundsChanged = match.lowerBound !== incoming.lowerBound || match.upperBound !== incoming.upperBound;
    return {
      ...incoming,
      id: match.id,
      touchCount: Math.max(match.touchCount, incoming.touchCount),
      lastTouchedAt: laterDate({ left: match.lastTouchedAt, right: incoming.lastTouchedAt }),
      status: boundsChanged ? incoming.status : match.status === "BROKEN" || match.status === "FLIPPED" ? match.status : incoming.status,
      type: !boundsChanged && match.status === "FLIPPED" ? match.type : incoming.type,
      metadataJson: mergeZoneMetadata({
        existing: match.metadataJson,
        incoming: incoming.metadataJson,
        resetProcessing: boundsChanged,
      }),
    };
  });
  const leftovers = existingAuto.filter((zone) => {
    const key = zone.id ?? `${zone.lowerBound}:${zone.upperBound}`;
    return !used.has(key) && (zone.status === "BROKEN" || zone.status === "FLIPPED");
  });
  return [...manuals, ...kept, ...merged, ...leftovers];
}

export function mergePriorZones(args: { existing: PriceZone[]; incoming: PriceZone[] }): PriceZone[] {
  return args.incoming.map((incoming) => {
    const periodKey = incoming.metadataJson.periodKey;
    const match = args.existing.find(
      (zone) =>
        zone.source === incoming.source &&
        zone.metadataJson.periodKey === periodKey &&
        priorTypesAlign({ incoming: incoming.type, existing: zone }),
    );
    if (!match) {
      return incoming;
    }
    return {
      ...incoming,
      id: match.id,
      status: match.status,
      type: match.status === "FLIPPED" ? match.type : incoming.type,
      touchCount: Math.max(match.touchCount, incoming.touchCount),
      lastTouchedAt: laterDate({ left: match.lastTouchedAt, right: incoming.lastTouchedAt }),
      strengthScore: match.strengthScore,
      metadataJson: mergeZoneMetadata({
        existing: match.metadataJson,
        incoming: incoming.metadataJson,
        resetProcessing: false,
      }),
    };
  });
}

export function reactionAfterTouch(args: {
  zone: PriceZone;
  candles: StructureBar[];
  atr: string | null;
}): string | null {
  if (!args.atr || new Decimal(args.atr).eq(0) || !args.zone.lastTouchedAt) {
    return null;
  }
  let max = new Decimal(0);
  for (const candle of args.candles) {
    if (!candle.isFinal || candle.openTimeUtc.getTime() <= args.zone.lastTouchedAt.getTime()) {
      continue;
    }
    for (const price of [candle.high, candle.low, candle.close]) {
      const distance = distanceFromZoneInAtr({
        price,
        lowerBound: args.zone.lowerBound,
        upperBound: args.zone.upperBound,
        atr: args.atr,
      });
      if (distance) {
        const value = new Decimal(distance);
        if (value.gt(max)) {
          max = value;
        }
      }
    }
  }
  return max.gt(0) ? max.toString() : null;
}

export function scoreZoneStrength(args: {
  zone: PriceZone;
  multiTimeframe: boolean;
  lastBarOpen: Date;
  barMs: number;
  reactionAtr?: string | null;
}): number {
  const touches = Math.min(args.zone.touchCount, 4);
  const last = args.zone.lastTouchedAt?.getTime() ?? 0;
  const recent = args.lastBarOpen.getTime() - last <= STRUCTURE_DEFAULTS.recentTouchBars * args.barMs;
  const reaction =
    args.reactionAtr && new Decimal(args.reactionAtr).gte(STRUCTURE_DEFAULTS.reactionAtr) ? 10 : 0;
  const weak = Number(args.zone.metadataJson.weakTouches ?? 0);
  const broken = args.zone.status === "BROKEN" || args.zone.status === "FLIPPED" ? 40 : 0;
  const score = 20 + touches * 15 + (args.multiTimeframe ? 20 : 0) + (recent ? 10 : 0) + reaction - weak * 10 - broken;
  return Math.max(0, Math.min(100, score));
}

export function nearestZone(args: {
  price: string;
  zones: PriceZone[];
  atr: string | null;
  type?: ZoneType;
}): { zone: PriceZone; distanceAtr: string | null } | null {
  const active = args.zones.filter(
    (zone) =>
      zone.status === "ACTIVE" &&
      (args.type === undefined || zone.type === args.type || zone.type === "BOTH"),
  );
  if (active.length === 0) {
    return null;
  }
  let best: { zone: PriceZone; distanceAtr: string | null } | null = null;
  for (const zone of active) {
    const distanceAtr = distanceFromZoneInAtr({
      price: args.price,
      lowerBound: zone.lowerBound,
      upperBound: zone.upperBound,
      atr: args.atr,
    });
    if (!best) {
      best = { zone, distanceAtr };
      continue;
    }
    const current = new Decimal(distanceAtr ?? Number.POSITIVE_INFINITY);
    const previous = new Decimal(best.distanceAtr ?? Number.POSITIVE_INFINITY);
    if (current.lt(previous)) {
      best = { zone, distanceAtr };
    }
  }
  return best;
}

function applyZoneBreaksToZone(args: {
  zone: PriceZone;
  candles: StructureBar[];
  atr: string | null;
}): PriceZone {
  if (args.zone.status === "EXPIRED") {
    return args.zone;
  }
  const last = args.candles[args.candles.length - 1];
  let current = args.zone;
  const alreadyProcessed = lastProcessedTime({ zone: current });
  for (let index = 0; index < args.candles.length; index += 1) {
    const candle = args.candles[index];
    if (!candle) {
      continue;
    }
    if (alreadyProcessed !== null && candle.openTimeUtc.getTime() <= alreadyProcessed) {
      continue;
    }
    const previous = index > 0 ? args.candles[index - 1] : null;
    current = applyOneCandle({
      zone: current,
      candle,
      previousClose: previous?.close ?? null,
      atr: args.atr,
      isLast: last !== undefined && candle.openTimeUtc.getTime() === last.openTimeUtc.getTime(),
    });
    current = {
      ...current,
      metadataJson: {
        ...current.metadataJson,
        lastProcessedOpenTime: candle.openTimeUtc.toISOString(),
      },
    };
  }
  return current;
}

function applyOneCandle(args: {
  zone: PriceZone;
  candle: StructureBar;
  previousClose: string | null;
  atr: string | null;
  isLast: boolean;
}): PriceZone {
  if (args.zone.status === "EXPIRED") {
    return args.zone;
  }
  const side = closeBreaksZone({ close: args.candle.close, zone: args.zone, atr: args.atr });
  const crossed = closeCrossesZone({
    close: args.candle.close,
    previousClose: args.previousClose,
    zone: args.zone,
    atr: args.atr,
  });
  if (crossed && args.zone.status === "ACTIVE") {
    return {
      ...args.zone,
      status: "BROKEN",
      lastTouchedAt: args.candle.openTimeUtc,
      strengthScore: Math.max(0, args.zone.strengthScore - 40),
      metadataJson: {
        ...args.zone.metadataJson,
        lastReaction: `close broke ${crossed}`,
        brokenAt: args.candle.openTimeUtc.toISOString(),
      },
    };
  }
  if (side && args.zone.status === "BROKEN") {
    const brokenAt = brokenAtTime({ zone: args.zone });
    if (brokenAt !== null && args.candle.openTimeUtc.getTime() > brokenAt) {
      const flippedType: ZoneType =
        args.zone.type === "SUPPORT" ? "RESISTANCE" : args.zone.type === "RESISTANCE" ? "SUPPORT" : args.zone.type;
      return {
        ...args.zone,
        status: "FLIPPED",
        type: flippedType,
        lastTouchedAt: args.candle.openTimeUtc,
        metadataJson: {
          ...args.zone.metadataJson,
          lastReaction: `accepted ${side}; flipped to ${flippedType}`,
        },
      };
    }
  }
  if (
    args.isLast &&
    !side &&
    args.zone.status === "ACTIVE" &&
    wickTouchesZone({ candle: args.candle, zone: args.zone })
  ) {
    if (args.zone.lastTouchedAt?.getTime() === args.candle.openTimeUtc.getTime()) {
      return args.zone;
    }
    return {
      ...args.zone,
      touchCount: args.zone.touchCount + 1,
      lastTouchedAt: args.candle.openTimeUtc,
      strengthScore: Math.max(0, args.zone.strengthScore - 10),
      metadataJson: {
        ...args.zone.metadataJson,
        lastReaction: "wick touch without close penetration",
        weakTouches: Number(args.zone.metadataJson.weakTouches ?? 0) + 1,
      },
    };
  }
  return args.zone;
}

function lastProcessedTime(args: { zone: PriceZone }): number | null {
  const value = args.zone.metadataJson.lastProcessedOpenTime;
  if (typeof value !== "string") {
    return null;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function brokenAtTime(args: { zone: PriceZone }): number | null {
  const value = args.zone.metadataJson.brokenAt;
  if (typeof value !== "string") {
    return null;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function latestPivotTime(args: { pivots: ConfirmedPivot[] }): Date | null {
  return args.pivots.reduce<Date | null>((latest, pivot) => {
    if (!latest || pivot.openTimeUtc.getTime() > latest.getTime()) {
      return pivot.openTimeUtc;
    }
    return latest;
  }, null);
}

function mergeZoneMetadata(args: {
  existing: Record<string, unknown>;
  incoming: Record<string, unknown>;
  resetProcessing: boolean;
}): Record<string, unknown> {
  const merged = { ...args.existing, ...args.incoming };
  if (args.resetProcessing) {
    delete merged.lastProcessedOpenTime;
    delete merged.brokenAt;
    return merged;
  }
  return {
    ...merged,
    lastProcessedOpenTime: args.existing.lastProcessedOpenTime,
    brokenAt: args.existing.brokenAt,
    weakTouches: args.existing.weakTouches,
  };
}

function zoneTypeFromPivots(args: { pivots: ConfirmedPivot[] }): ZoneType {
  const highs = args.pivots.every((item) => item.type === "HIGH");
  const lows = args.pivots.every((item) => item.type === "LOW");
  if (highs) {
    return "RESISTANCE";
  }
  if (lows) {
    return "SUPPORT";
  }
  return "BOTH";
}

function rangeZones(args: {
  bars: StructureBar[];
  instrumentId: string;
  timeframe: Timeframe;
  source: "PRIOR_DAY" | "PRIOR_WEEK";
  periodKey: string;
}): PriceZone[] {
  if (args.bars.length === 0) {
    return [];
  }
  const high = Decimal.max(...args.bars.map((bar) => bar.high)).toString();
  const low = Decimal.min(...args.bars.map((bar) => bar.low)).toString();
  return [
    thinZone({
      instrumentId: args.instrumentId,
      timeframe: args.timeframe,
      type: "RESISTANCE",
      source: args.source,
      price: high,
      periodKey: args.periodKey,
      why: `${args.source} high ${args.periodKey}`,
    }),
    thinZone({
      instrumentId: args.instrumentId,
      timeframe: args.timeframe,
      type: "SUPPORT",
      source: args.source,
      price: low,
      periodKey: args.periodKey,
      why: `${args.source} low ${args.periodKey}`,
    }),
  ];
}

function thinZone(args: {
  instrumentId: string;
  timeframe: Timeframe;
  type: ZoneType;
  source: "PRIOR_DAY" | "PRIOR_WEEK";
  price: string;
  periodKey: string;
  why: string;
}): PriceZone {
  return {
    instrumentId: args.instrumentId,
    timeframe: args.timeframe,
    type: args.type,
    source: args.source,
    lowerBound: args.price,
    upperBound: args.price,
    midpoint: args.price,
    strengthScore: 30,
    touchCount: 1,
    lastTouchedAt: null,
    status: "ACTIVE",
    metadataJson: { periodKey: args.periodKey, why: args.why },
  };
}

function utcDayKey(args: { at: Date }): string {
  return args.at.toISOString().slice(0, 10);
}

function startOfUtcWeek(args: { at: Date }): Date {
  const day = args.at.getUTCDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(args.at.getUTCFullYear(), args.at.getUTCMonth(), args.at.getUTCDate() - mondayOffset));
}

function utcWeekKey(args: { at: Date }): string {
  return utcDayKey({ at: startOfUtcWeek(args) });
}

function priorTypesAlign(args: { incoming: ZoneType; existing: PriceZone }): boolean {
  if (args.existing.type === args.incoming) {
    return true;
  }
  if (args.existing.status !== "FLIPPED") {
    return false;
  }
  const original: ZoneType =
    args.existing.type === "SUPPORT" ? "RESISTANCE" : args.existing.type === "RESISTANCE" ? "SUPPORT" : args.existing.type;
  return original === args.incoming;
}

function laterDate(args: { left: Date | null; right: Date | null }): Date | null {
  if (!args.left) {
    return args.right;
  }
  if (!args.right) {
    return args.left;
  }
  return args.left.getTime() >= args.right.getTime() ? args.left : args.right;
}
