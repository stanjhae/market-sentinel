import { Decimal } from "decimal.js";

export function decimalOrZero(args: { value: unknown }): Decimal {
  if (args.value === null || args.value === undefined || args.value === "") {
    return new Decimal(0);
  }
  try {
    return new Decimal(args.value as Decimal.Value);
  } catch {
    return new Decimal(0);
  }
}

export function decimalString(args: { value: Decimal.Value }): string {
  return new Decimal(args.value).toString();
}

export function optionalDecimalString(args: { value: unknown }): string | null {
  if (args.value === null || args.value === undefined || args.value === "") {
    return null;
  }
  try {
    return new Decimal(args.value as Decimal.Value).toString();
  } catch {
    return null;
  }
}

export function utcDayStart(args: { now: Date }): Date {
  return new Date(Date.UTC(args.now.getUTCFullYear(), args.now.getUTCMonth(), args.now.getUTCDate()));
}

export function utcDayEnd(args: { now: Date }): Date {
  return new Date(utcDayStart(args).getTime() + 24 * 60 * 60 * 1000);
}

export function addMinutes(args: { at: Date; minutes: number }): Date {
  return new Date(args.at.getTime() + args.minutes * 60 * 1000);
}

export function minDateString(args: { now: Date; lookbackDays: number }): string {
  const start = new Date(args.now.getTime() - args.lookbackDays * 24 * 60 * 60 * 1000);
  return start.toISOString().slice(0, 10);
}

export function normalizeOpenedAt(args: { value: string | null }): string | null {
  if (!args.value) {
    return null;
  }
  const time = new Date(args.value).getTime();
  if (Number.isNaN(time)) {
    return args.value;
  }
  return new Date(time).toISOString();
}

function sameDecimal(args: { left: string | null; right: string | null }): boolean {
  if (args.left === args.right) {
    return true;
  }
  if (args.left === null || args.right === null) {
    return false;
  }
  try {
    return new Decimal(args.left).eq(args.right);
  } catch {
    return args.left === args.right;
  }
}

export function identityChanged(args: {
  previous: { openPrice: string | null; units: string | null; openedAt: string | null };
  next: { openPrice: string | null; units: string | null; openedAt: string | null };
}): boolean {
  return (
    !sameDecimal({ left: args.previous.openPrice, right: args.next.openPrice }) ||
    !sameDecimal({ left: args.previous.units, right: args.next.units }) ||
    normalizeOpenedAt({ value: args.previous.openedAt }) !== normalizeOpenedAt({ value: args.next.openedAt })
  );
}
