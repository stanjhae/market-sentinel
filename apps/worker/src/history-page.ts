export const HISTORY_PAGE_SIZE = 100;
export const HISTORY_MAX_PAGES = 20;

export function tradeHistoryItemFingerprint(args: {
  item: {
    positionId?: number;
    instrumentId?: number;
    openTimestamp?: string;
    closeTimestamp?: string;
  } | null;
}): string | null {
  if (!args.item) {
    return null;
  }
  const fingerprint = [
    args.item.positionId ?? "",
    args.item.instrumentId ?? "",
    args.item.openTimestamp ?? "",
    args.item.closeTimestamp ?? "",
  ].join(":");
  return fingerprint === ":::" ? null : fingerprint;
}

export function nextTradeHistoryPage(args: {
  page: number;
  itemCount: number;
  firstFingerprint: string | null;
  previousFirstFingerprint: string | null;
  pageSize?: number;
  maxPages?: number;
}): { nextPage: number; done: boolean; reason?: "empty" | "last-page" | "repeat-page" | "max-pages" } {
  const pageSize = args.pageSize ?? HISTORY_PAGE_SIZE;
  const maxPages = args.maxPages ?? HISTORY_MAX_PAGES;
  if (args.itemCount === 0) {
    return { nextPage: args.page, done: true, reason: "empty" };
  }
  if (args.itemCount < pageSize) {
    return { nextPage: args.page, done: true, reason: "last-page" };
  }
  if (
    args.previousFirstFingerprint !== null &&
    args.firstFingerprint !== null &&
    args.firstFingerprint === args.previousFirstFingerprint
  ) {
    return { nextPage: args.page, done: true, reason: "repeat-page" };
  }
  if (args.page > 1 && args.firstFingerprint === null && args.previousFirstFingerprint === null) {
    return { nextPage: args.page, done: true, reason: "repeat-page" };
  }
  if (args.page >= maxPages) {
    return { nextPage: args.page, done: true, reason: "max-pages" };
  }
  return { nextPage: args.page + 1, done: false };
}
