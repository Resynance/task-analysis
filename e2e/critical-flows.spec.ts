import { expect, test } from "@playwright/test";

test.describe("critical flows", () => {
  test("configuration ingest page loads", async ({ page }) => {
    await page.goto("/configuration/ingest-data");
    await expect(
      page.getByRole("button", { name: /run ingest from disk/i }),
    ).toBeVisible();
  });

  test("metrics overview loads", async ({ page }) => {
    await page.goto("/metrics");
    await expect(
      page.getByRole("heading", { level: 1, name: "Metrics" }),
    ).toBeVisible();
  });
});
