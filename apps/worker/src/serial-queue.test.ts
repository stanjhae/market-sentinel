import { describe, expect, it } from "vitest";
import { createSerialQueue } from "./serial-queue.js";

describe("createSerialQueue", () => {
  it("runs tasks for the same queue in enqueue order", async () => {
    const queue = createSerialQueue();
    const seen: number[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue({
      task: async () => {
        await firstGate;
        seen.push(1);
      },
    });
    const second = queue.enqueue({
      task: async () => {
        seen.push(2);
      },
    });

    expect(seen).toEqual([]);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(seen).toEqual([1, 2]);
  });
});
