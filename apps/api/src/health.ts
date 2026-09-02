import type { HealthReady } from "@market-sentinel/contracts";

export function composeReady(args: { checks: HealthReady["checks"] }): boolean {
  return args.checks.database && args.checks.redis && args.checks.credentials && args.checks.marketStream;
}
