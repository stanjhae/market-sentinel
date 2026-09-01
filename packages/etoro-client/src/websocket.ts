import WebSocket from "ws";
import { decimalString } from "./format.js";
import { createRequestId } from "./request-id.js";
import { isStreamStale, nextBackoffMs } from "./stream.js";
import type { EtoroClientConfig, MarketTick } from "./types.js";

export type StreamStatus = "CONNECTING" | "LIVE" | "RECONNECTING" | "STALE" | "DISCONNECTED";

export type MarketStreamHandlers = {
  onTick?: (tick: MarketTick) => void;
  onStatus?: (status: StreamStatus) => void;
};

export type WebSocketLike = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  ping?: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
};

export type WebSocketFactory = (url: string) => WebSocketLike;

type StreamDeps = {
  createSocket?: WebSocketFactory;
  now?: () => number;
  random?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

type RateContent = {
  Ask?: unknown;
  Bid?: unknown;
  LastExecution?: unknown;
  Date?: unknown;
  PriceRateID?: unknown;
  ask?: unknown;
  bid?: unknown;
  lastExecution?: unknown;
  date?: unknown;
  priceRateID?: unknown;
};

export class EtoroMarketStream {
  private socket: WebSocketLike | null = null;
  private reconnectAttempt = 0;
  private stopped = false;
  private lastEventAt: Date | null = null;
  private seenEventIds = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private instrumentIds: number[] = [];
  private reconnectCount = 0;
  private status: StreamStatus = "DISCONNECTED";

  constructor(
    private readonly config: EtoroClientConfig,
    private readonly handlers: MarketStreamHandlers = {},
    private readonly deps: StreamDeps = {},
  ) {}

  getReconnectCount() {
    return this.reconnectCount;
  }

  getLastEventAt() {
    return this.lastEventAt;
  }

  getStatus() {
    return this.status;
  }

  start(instrumentIds: number[]) {
    this.instrumentIds = [...instrumentIds];
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
    this.setStatus("DISCONNECTED");
  }

  simulateDisconnect() {
    this.socket?.close();
  }

  private connect() {
    if (this.stopped) {
      return;
    }
    this.setStatus(this.reconnectCount > 0 ? "RECONNECTING" : "CONNECTING");
    const factory =
      this.deps.createSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
    const socket = factory(this.config.wsUrl);
    this.socket = socket;

    socket.on("open", () => {
      this.authenticate(socket);
    });
    socket.on("message", (data: unknown) => {
      this.handleMessage(String(data));
    });
    socket.on("close", () => {
      this.scheduleReconnect();
    });
    socket.on("error", () => {
      socket.close();
    });
  }

  private authenticate(socket: WebSocketLike) {
    socket.send(
      JSON.stringify({
        id: createRequestId(),
        operation: "Authenticate",
        data: {
          userKey: this.config.userKey,
          apiKey: this.config.apiKey,
        },
      }),
    );
  }

  private subscribe(socket: WebSocketLike) {
    if (this.instrumentIds.length === 0) {
      return;
    }
    socket.send(
      JSON.stringify({
        id: createRequestId(),
        operation: "Subscribe",
        data: {
          topics: this.instrumentIds.map((id) => `instrument:${id}`),
          snapshot: true,
        },
      }),
    );
  }

  private handleMessage(raw: string) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    if (parsed.operation === "Authenticate" && parsed.success === true) {
      this.reconnectAttempt = 0;
      this.setStatus("LIVE");
      if (this.socket) {
        this.subscribe(this.socket);
      }
      this.armStaleWatch();
      return;
    }

    const messages = parsed.messages;
    if (!Array.isArray(messages)) {
      return;
    }

    for (const message of messages) {
      if (!message || typeof message !== "object") {
        continue;
      }
      const envelope = message as { id?: string; topic?: string; type?: string; content?: string };
      if (envelope.id && this.seenEventIds.has(envelope.id)) {
        continue;
      }
      if (envelope.id) {
        this.seenEventIds.add(envelope.id);
        if (this.seenEventIds.size > 2000) {
          this.seenEventIds.clear();
        }
      }
      if (typeof envelope.content !== "string") {
        continue;
      }
      const topic = envelope.topic ?? "";
      const match = /^instrument:(\d+)$/.exec(topic);
      if (!match?.[1]) {
        continue;
      }
      const content = JSON.parse(envelope.content) as RateContent;
      const rawDate = content.Date ?? content.date;
      const parsedDate = typeof rawDate === "string" ? Date.parse(rawDate) : Number.NaN;
      const tick: MarketTick = {
        instrumentId: Number(match[1]),
        bid: decimalString(content.Bid ?? content.bid),
        ask: decimalString(content.Ask ?? content.ask),
        last: decimalString(content.LastExecution ?? content.lastExecution),
        quotedAt: Number.isFinite(parsedDate)
          ? new Date(parsedDate).toISOString()
          : new Date(this.now()).toISOString(),
        priceRateId: decimalString(content.PriceRateID ?? content.priceRateID),
      };
      this.lastEventAt = new Date(this.now());
      this.setStatus("LIVE");
      this.handlers.onTick?.(tick);
    }
    this.armStaleWatch();
  }

  private scheduleReconnect() {
    if (this.stopped) {
      return;
    }
    this.reconnectCount += 1;
    this.reconnectAttempt += 1;
    this.setStatus("RECONNECTING");
    const delay = nextBackoffMs({
      attempt: this.reconnectAttempt,
      jitter: (this.deps.random ?? Math.random)(),
    });
    const setTimeoutFn = this.deps.setTimeoutFn ?? setTimeout;
    this.reconnectTimer = setTimeoutFn(() => {
      this.connect();
    }, delay);
  }

  private armStaleWatch() {
    const clearTimeoutFn = this.deps.clearTimeoutFn ?? clearTimeout;
    const setTimeoutFn = this.deps.setTimeoutFn ?? setTimeout;
    if (this.staleTimer) {
      clearTimeoutFn(this.staleTimer);
    }
    const staleAfterMs = this.config.staleAfterMs ?? 15_000;
    this.staleTimer = setTimeoutFn(() => {
      if (
        isStreamStale({
          lastEventAt: this.lastEventAt,
          now: new Date(this.now()),
          staleAfterMs,
        })
      ) {
        this.setStatus("STALE");
      }
    }, staleAfterMs + 50);
  }

  private clearTimers() {
    const clearTimeoutFn = this.deps.clearTimeoutFn ?? clearTimeout;
    if (this.reconnectTimer) {
      clearTimeoutFn(this.reconnectTimer);
    }
    if (this.staleTimer) {
      clearTimeoutFn(this.staleTimer);
    }
  }

  private setStatus(status: StreamStatus) {
    this.status = status;
    this.handlers.onStatus?.(status);
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }
}
