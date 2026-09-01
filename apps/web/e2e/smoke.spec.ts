import { expect, test } from "playwright/test";

test("dashboard renders the product name", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Market Sentinel")).toBeVisible();
});
