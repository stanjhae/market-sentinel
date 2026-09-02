import { Decimal } from "decimal.js";

export function decimalOrNull(args: { value: unknown }): Decimal | null {
  if (args.value === null || args.value === undefined || args.value === "") {
    return null;
  }
  try {
    const next = new Decimal(args.value as Decimal.Value);
    return next.isFinite() ? next : null;
  } catch {
    return null;
  }
}

export function decimalString(args: { value: Decimal }): string {
  return args.value.toString();
}

export function optionalDecimalString(args: { value: Decimal | null }): string | null {
  return args.value ? args.value.toString() : null;
}

export function maxDecimal(args: { left: Decimal | null; right: Decimal | null }): Decimal | null {
  if (!args.left) {
    return args.right;
  }
  if (!args.right) {
    return args.left;
  }
  return args.left.greaterThan(args.right) ? args.left : args.right;
}
