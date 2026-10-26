import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const demoBase = "http://127.0.0.1:4174";
const criticalRoutes = [
  "/overview",
  "/command",
  "/workflow-studio",
  "/graph",
  "/software-factory",
  "/integrations",
  "/security-center",
] as const;
const responsiveRoutes = [
  "/command",
  "/workflow-studio",
  "/graph",
  "/operations",
  "/agent-teams",
  "/creative",
  "/analytics",
] as const;
const viewportWidths = [320, 375, 390, 430, 768, 1024, 1440, 1920] as const;

async function isolateBackend(page: Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "e2e_unavailable", message: "E2E backend unavailable" },
      }),
    });
  });
}

async function openDemoRoute(page: Page, route: string) {
  await page.goto(`${demoBase}${route}`);
  // The dev server compiles the lazy control-center route chunk on first
  // request, so wait for the shell to leave its loading state before asserting.
  await expect(page.getByRole("main")).toBeVisible({ timeout: 60_000 });
}

test("development demo shell navigation responds without a framework crash", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await isolateBackend(page);
  await openDemoRoute(page, "/overview");
  await expect(page.locator("body")).toContainText(/overview/i, {
    timeout: 30_000,
  });

  const commandLink = page.getByRole("link", { name: /command/i }).first();
  await expect(commandLink).toBeVisible();
  await commandLink.click();
  await expect(page).toHaveURL(/\/command$/);
  await expect(page.locator("body")).not.toContainText(
    /unexpected application error/i,
  );
});

test("demo shell has no critical or serious automated axe violations", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await isolateBackend(page);
  await openDemoRoute(page, "/overview");
  await expect(page.locator("body")).toContainText(/overview/i, {
    timeout: 30_000,
  });
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === "critical" || violation.impact === "serious",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
});

for (const route of criticalRoutes) {
  test(`demo shell route ${route} renders its safe backend error state`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await isolateBackend(page);
    await openDemoRoute(page, route);
    await expect(page.locator("body")).not.toContainText(
      /unexpected application error/i,
    );
    await expect(page.locator("body")).not.toContainText(
      /failed to fetch dynamically imported module/i,
    );
  });
}

for (const width of viewportWidths) {
  test(`critical demo-shell routes do not overflow at ${width}px`, async ({
    page,
  }) => {
    // Seven full SPA reloads at one width; the default 30 s budget is for a
    // single navigation, not a cold dev-server route sweep.
    test.setTimeout(240_000);
    await isolateBackend(page);
    await page.setViewportSize({ width, height: width <= 430 ? 844 : 900 });
    for (const route of responsiveRoutes) {
      await openDemoRoute(page, route);
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(
        dimensions.scrollWidth,
        `${route} overflow at ${width}px`,
      ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    }
  });
}
