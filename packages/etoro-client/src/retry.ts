const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isIdempotentMethod(method: string): boolean {
  return IDEMPOTENT_METHODS.has(method.toUpperCase());
}

export function shouldRetry(args: { method: string; status?: number; attempt: number; maxAttempts: number }): boolean {
  if (args.attempt >= args.maxAttempts) {
    return false;
  }
  if (!isIdempotentMethod(args.method)) {
    return false;
  }
  if (args.status === undefined) {
    return true;
  }
  return args.status === 429 || args.status >= 500;
}

export function shouldRetryExecutionPost(args: { status?: number; attempt: number; maxAttempts: number }): boolean {
  if (args.attempt >= args.maxAttempts) {
    return false;
  }
  return args.status === 429;
}
