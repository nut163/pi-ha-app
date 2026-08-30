import { expect, test } from "@playwright/test";

test("first-run onboarding explains the safety model", async ({ page }) => {
  await page.route("**/api/provider/models", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ provider: "openai-compatible", models: [{ id: "e2e-model", name: "E2E model" }] }),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Make changes with context, guardrails, and a way back." })).toBeVisible();
  await expect(page.getByText("Provider keys are encrypted at rest")).toBeVisible();
  await page.getByRole("button", { name: /Set up Pi Home Agent/ }).click();
  await expect(page.getByRole("heading", { name: "Let’s meet your Home Assistant." })).toBeVisible();
  await page.getByRole("button", { name: "Continue with current status" }).click();
  await expect(page.getByRole("heading", { name: "Choose the model that thinks with you." })).toBeVisible();
  await expect(page.locator('select option[value="e2e-model"]')).toBeAttached();
});
