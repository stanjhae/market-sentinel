export function nextBackoffMs(args: { attempt: number; baseMs?: number; maxMs?: number; jitter?: number }): number {
  const baseMs = args.baseMs ?? 500;
  const maxMs = args.maxMs ?? 30_000;
  const jitter = args.jitter ?? Math.random();
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, args.attempt - 1));
  return Math.round(exp * (0.5 + jitter * 0.5));
}

export function isStreamStale(args: { lastEventAt: Date | null; now?: Date; staleAfterMs: number }): boolean {
  if (!args.lastEventAt) {
    return true;
  }
  const now = args.now ?? new Date();
  return now.getTime() - args.lastEventAt.getTime() > args.staleAfterMs;
}
