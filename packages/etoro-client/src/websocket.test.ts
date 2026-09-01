import { describe, expect, it } from "vitest";
import { EtoroMarketStream, type WebSocketLike } from "./websocket.js";
import type { EtoroClientConfig } from "./types.js";

class FakeSocket implements WebSocketLike {
  readyState = 1;
  sent: string[] = [];
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  on(event: string, listener: (...args: unknown[]) => void) {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.emit("close");
  }

  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

const config: EtoroClientConfig = {
  apiKey: "api-secret",
  userKey: "user-secret",
  accountType: "real",
  restBaseUrl: "https://public-api.etoro.com",
  wsUrl: "wss://ws.etoro.com/ws",
  staleAfterMs: 15_000,
};

describe("EtoroMarketStream", () => {
  it("authenticates, subscribes, dedupes, and reconnects after drop", () => {
    const sockets: FakeSocket[] = [];
    const ticks: number[] = [];
    const statuses: string[] = [];

    const stream = new EtoroMarketStream(
      config,
      {
        onTick: (tick) => ticks.push(tick.instrumentId),
        onStatus: (status) => statuses.push(status),
      },
      {
        createSocket: () => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket;
        },
        random: () => 0,
        setTimeoutFn: ((fn: () => void) => {
          fn();
          return 1 as unknown as NodeJS.Timeout;
        }) as typeof setTimeout,
        clearTimeoutFn: () => undefined,
      },
    );

    stream.start([17]);
    const first = sockets[0];
    expect(first).toBeDefined();
    first?.emit("open");
    expect(first?.sent[0]).toContain("Authenticate");
    first?.emit(
      "message",
      JSON.stringify({ id: "auth", success: true, operation: "Authenticate" }),
    );
    expect(first?.sent[1]).toContain("instrument:17");

    const payload = JSON.stringify({
      messages: [
        {
          id: "evt-1",
          topic: "instrument:17",
          type: "Trading.Instrument.Rate",
          content: JSON.stringify({ Bid: "1.1", Ask: "1.2", LastExecution: "1.15", Date: "2026-09-01T12:00:00Z" }),
        },
      ],
    });
    first?.emit("message", payload);
    first?.emit("message", payload);
    expect(ticks).toEqual([17]);

    first?.close();
    expect(stream.getReconnectCount()).toBe(1);
    expect(sockets.length).toBe(2);
    sockets[1]?.emit("open");
    sockets[1]?.emit(
      "message",
      JSON.stringify({ id: "auth-2", success: true, operation: "Authenticate" }),
    );
    expect(sockets[1]?.sent.some((item) => item.includes("Subscribe"))).toBe(true);
    stream.stop();
  });
});
