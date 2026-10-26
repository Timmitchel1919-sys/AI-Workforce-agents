import { expect, test, type Page } from "@playwright/test";

interface E2eIdentities {
  ownerEmail: string;
  pendingEmail: string;
  viewerEmail: string;
  password: string;
}

function readIdentities(): E2eIdentities {
  const ownerEmail = process.env.AIW_E2E_OWNER_EMAIL;
  const pendingEmail = process.env.AIW_E2E_PENDING_EMAIL;
  const viewerEmail = process.env.AIW_E2E_VIEWER_EMAIL;
  const password = process.env.AIW_E2E_PASSWORD;
  if (!ownerEmail || !pendingEmail || !viewerEmail || !password) {
    throw new Error(
      "authenticated E2E identities were not provisioned by the emulator runner",
    );
  }
  return { ownerEmail, pendingEmail, viewerEmail, password };
}

const { ownerEmail, pendingEmail, viewerEmail, password } = readIdentities();

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /enter workforce/i }).click();
}

test("unauthenticated direct navigation returns to the secure gateway", async ({ page }) => {
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/login\?next=%2Foverview$/);
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("a valid Firebase identity without active operator access remains denied", async ({ page }) => {
  await signIn(page, pendingEmail);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(/current view/i)).toHaveCount(0);
});

test("an active owner signs in through Firebase and reaches the protected shell", async ({ page }) => {
  await signIn(page, ownerEmail);
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByText("Overview", { exact: true }).first()).toBeVisible();

  await page.goto("/settings/access");
  await expect(page.getByRole("heading", { name: "Users & Access" })).toBeVisible();
  await expect(page.getByText(ownerEmail)).toBeVisible();
});

test("an authenticated viewer cannot open an administrator route", async ({ page }) => {
  await signIn(page, viewerEmail);
  await expect(page).toHaveURL(/\/overview$/);
  await page.goto("/settings/access");
  const restricted = page.getByRole("region", { name: /access restricted/i });
  await expect(restricted.getByRole("heading", { name: /access restricted/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Users & Access" })).toHaveCount(0);
});

test("sign out clears the emulator session and closes protected routes", async ({ page }) => {
  await signIn(page, ownerEmail);
  await expect(page).toHaveURL(/\/overview$/);
  await page.getByRole("button", { name: /account menu/i }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/login\?next=%2Foverview$/);
});
