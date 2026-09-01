import { Decimal } from "decimal.js";

export function decimalString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  try {
    return new Decimal(value as Decimal.Value).toString();
  } catch {
    return null;
  }
}
