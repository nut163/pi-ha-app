import { expect, test } from "@playwright/test";

test("first-run onboarding explains the safety model", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Make changes with context, guardrails, and a way back." })).toBeVisible();
  await expect(page.getByText("Provider keys are encrypted at rest")).toBeVisible();
  await page.getByRole("button", { name: /Set up Pi Home Agent/ }).click();
  await expect(page.getByRole("heading", { name: "Let’s meet your Home Assistant." })).toBeVisible();
  await page.getByRole("button", { name: "Continue with current status" }).click();
  await expect(page.getByRole("heading", { name: "Choose the model that thinks with you." })).toBeVisible();
});
