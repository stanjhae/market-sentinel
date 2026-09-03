export const HISTORY_PAGE_SIZE = 100;
export const HISTORY_MAX_PAGES = 20;

export function nextTradeHistoryPage(args: {
  page: number;
  itemCount: number;
  firstPositionId: number | null;
  previousFirstPositionId: number | null;
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
    args.previousFirstPositionId !== null &&
    args.firstPositionId !== null &&
    args.firstPositionId === args.previousFirstPositionId
  ) {
    return { nextPage: args.page, done: true, reason: "repeat-page" };
  }
  if (args.page >= maxPages) {
    return { nextPage: args.page, done: true, reason: "max-pages" };
  }
  return { nextPage: args.page + 1, done: false };
}
