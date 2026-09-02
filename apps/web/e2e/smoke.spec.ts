import { expect, test } from "playwright/test";

test("dashboard renders the product name", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Market Sentinel")).toBeVisible();
  await expect(page.getByRole("link", { name: "Journal" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Analytics" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Replay" })).toBeVisible();
});
