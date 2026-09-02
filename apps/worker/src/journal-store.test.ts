import { decideJournalClose } from "@market-sentinel/journal";
import { describe, expect, it } from "vitest";
import { isOpenJournal, primaryTrendFromSnapshot } from "./journal-store.js";

describe("journal store helpers", () => {
  it("reads 4H trend from a signal snapshot", () => {
    expect(
      primaryTrendFromSnapshot({
        snapshotJson: { multiTimeframe: { context4h: { primaryTrend: "BEAR" } } },
      }),
    ).toBe("BEAR");
    expect(primaryTrendFromSnapshot({ snapshotJson: {} })).toBeNull();
  });

  it("treats missing closedAt as an open journal row", () => {
    expect(isOpenJournal({ closedAt: null })).toBe(true);
    expect(isOpenJournal({ closedAt: new Date() })).toBe(false);
  });

  it("does not close from history while the position is still open", () => {
    expect(
      decideJournalClose({ alreadyClosed: false, stillOpenOnBroker: true, hasClosedHistory: true }),
    ).toBe("noop");
  });

  it("closes vanished opens when demo history is missing", () => {
    expect(
      decideJournalClose({ alreadyClosed: false, stillOpenOnBroker: false, hasClosedHistory: false }),
    ).toBe("close-vanished");
  });
});
