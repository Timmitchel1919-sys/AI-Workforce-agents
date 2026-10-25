import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const viewportWidths = [320, 375, 390, 430, 768, 1024, 1440, 1920] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(
    dimensions.clientWidth + 1,
  );
}

async function expectNoCriticalAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === "critical" || violation.impact === "serious",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

test("landing navigates to login and has no critical accessibility violations", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/AI Workforce/i);
  await expect(page.getByRole("main")).toBeVisible();

  const signIn = page.getByRole("link", { name: /sign in/i }).first();
  await expect(signIn).toBeVisible();
  await signIn.click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: /welcome back/i }),
  ).toBeVisible();
  await expectNoCriticalAxeViolations(page);
});

test("login validation and password-reset navigation are keyboard accessible", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /enter workforce/i }).click();
  await expect(page.getByText(/valid email/i)).toBeVisible();
  await expect(page.locator('input[name="email"]')).toBeFocused();

  await page.getByRole("link", { name: /forgot password/i }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByRole("button", { name: /send reset/i }).click();
  await expect(page.getByText(/valid email/i)).toBeVisible();
  await expectNoCriticalAxeViolations(page);
});

test("protected direct navigation fails closed without Firebase configuration", async ({
  page,
}) => {
  await page.goto("/overview");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText(/configuration|configuratie/i)).toBeVisible();
  await expect(page.getByText(/overview/i)).toHaveCount(0);
});

for (const width of viewportWidths) {
  test(`public routes do not overflow at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width <= 430 ? 844 : 900 });
    for (const route of ["/", "/login", "/forgot-password"]) {
      await page.goto(route);
      await expect(page.locator("body")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });
}
