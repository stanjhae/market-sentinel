import { describe, expect, it } from "vitest";
import {
  HISTORY_MAX_PAGES,
  HISTORY_PAGE_SIZE,
  nextTradeHistoryPage,
  tradeHistoryItemFingerprint,
} from "./history-page.js";

describe("nextTradeHistoryPage", () => {
  it("stops on an empty or short page", () => {
    expect(
      nextTradeHistoryPage({
        page: 1,
        itemCount: 0,
        firstFingerprint: null,
        previousFirstFingerprint: null,
      }),
    ).toEqual({ nextPage: 1, done: true, reason: "empty" });
    expect(
      nextTradeHistoryPage({
        page: 2,
        itemCount: HISTORY_PAGE_SIZE - 1,
        firstFingerprint: "9:1:a:b",
        previousFirstFingerprint: "1:1:a:b",
      }),
    ).toEqual({ nextPage: 2, done: true, reason: "last-page" });
  });

  it("advances when a full page is new", () => {
    expect(
      nextTradeHistoryPage({
        page: 1,
        itemCount: HISTORY_PAGE_SIZE,
        firstFingerprint: "10:1:a:b",
        previousFirstFingerprint: null,
      }),
    ).toEqual({ nextPage: 2, done: false });
  });

  it("stops when eToro repeats the same first row", () => {
    expect(
      nextTradeHistoryPage({
        page: 2,
        itemCount: HISTORY_PAGE_SIZE,
        firstFingerprint: "10:1:a:b",
        previousFirstFingerprint: "10:1:a:b",
      }),
    ).toEqual({ nextPage: 2, done: true, reason: "repeat-page" });
  });

  it("stops when two full pages have no first-row identity", () => {
    expect(tradeHistoryItemFingerprint({ item: {} })).toBeNull();
    expect(
      nextTradeHistoryPage({
        page: 2,
        itemCount: HISTORY_PAGE_SIZE,
        firstFingerprint: null,
        previousFirstFingerprint: null,
      }),
    ).toEqual({ nextPage: 2, done: true, reason: "repeat-page" });
  });

  it("caps lookback pagination", () => {
    expect(
      nextTradeHistoryPage({
        page: HISTORY_MAX_PAGES,
        itemCount: HISTORY_PAGE_SIZE,
        firstFingerprint: "99:1:a:b",
        previousFirstFingerprint: "1:1:a:b",
      }),
    ).toEqual({ nextPage: HISTORY_MAX_PAGES, done: true, reason: "max-pages" });
  });
});
