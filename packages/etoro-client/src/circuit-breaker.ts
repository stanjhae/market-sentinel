export type CircuitState = "closed" | "open" | "half_open";

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private readonly failureThreshold: number;
  private readonly resetMs: number;

  constructor(args: { failureThreshold?: number; resetMs?: number } = {}) {
    this.failureThreshold = args.failureThreshold ?? 5;
    this.resetMs = args.resetMs ?? 30_000;
  }

  state(now = Date.now()): CircuitState {
    if (this.openedAt === null) {
      return "closed";
    }
    if (now - this.openedAt >= this.resetMs) {
      return "half_open";
    }
    return "open";
  }

  allow(now = Date.now()): boolean {
    return this.state(now) !== "open";
  }

  recordSuccess() {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(now = Date.now()) {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.openedAt = now;
    }
  }
}
