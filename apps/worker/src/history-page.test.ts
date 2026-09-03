import { describe, expect, it } from "vitest";
import { HISTORY_MAX_PAGES, HISTORY_PAGE_SIZE, nextTradeHistoryPage } from "./history-page.js";

describe("nextTradeHistoryPage", () => {
  it("stops on an empty or short page", () => {
    expect(
      nextTradeHistoryPage({
        page: 1,
        itemCount: 0,
        firstPositionId: null,
        previousFirstPositionId: null,
      }),
    ).toEqual({ nextPage: 1, done: true, reason: "empty" });
    expect(
      nextTradeHistoryPage({
        page: 2,
        itemCount: HISTORY_PAGE_SIZE - 1,
        firstPositionId: 9,
        previousFirstPositionId: 1,
      }),
    ).toEqual({ nextPage: 2, done: true, reason: "last-page" });
  });

  it("advances when a full page is new", () => {
    expect(
      nextTradeHistoryPage({
        page: 1,
        itemCount: HISTORY_PAGE_SIZE,
        firstPositionId: 10,
        previousFirstPositionId: null,
      }),
    ).toEqual({ nextPage: 2, done: false });
  });

  it("stops when eToro repeats the same first position", () => {
    expect(
      nextTradeHistoryPage({
        page: 2,
        itemCount: HISTORY_PAGE_SIZE,
        firstPositionId: 10,
        previousFirstPositionId: 10,
      }),
    ).toEqual({ nextPage: 2, done: true, reason: "repeat-page" });
  });

  it("caps lookback pagination", () => {
    expect(
      nextTradeHistoryPage({
        page: HISTORY_MAX_PAGES,
        itemCount: HISTORY_PAGE_SIZE,
        firstPositionId: 99,
        previousFirstPositionId: 1,
      }),
    ).toEqual({ nextPage: HISTORY_MAX_PAGES, done: true, reason: "max-pages" });
  });
});
