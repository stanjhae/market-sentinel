import { pino, type Logger } from "pino";

export type LogBindings = {
  requestId?: string;
  instrumentId?: string;
  symbol?: string;
  signalId?: string;
  strategyKey?: string;
  strategyVersion?: string;
  tradePlanId?: string;
  brokerPositionId?: string;
};

export function createLogger(name: string, bindings: LogBindings = {}): Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? "info",
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { name, ...bindings },
    redact: {
      paths: [
        "ETORO_API_KEY",
        "ETORO_USER_KEY",
        "apiKey",
        "userKey",
        "headers.x-api-key",
        "headers.x-user-key",
      ],
      remove: true,
    },
  });
}

export type { Logger };
