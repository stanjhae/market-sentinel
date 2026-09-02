import type { AuthSession } from "@market-sentinel/contracts";

export function sessionAfterCheckFailure(): AuthSession {
  return { required: true, authenticated: false };
}
