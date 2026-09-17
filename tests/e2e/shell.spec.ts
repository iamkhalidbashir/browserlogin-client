import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const refreshSecret = "launch-secret";
const refreshApiKey = "bl_launch_secret";
const refreshUrl = "https://private.example.test/launch";
const redactionMarker = "<redacted>";

function observePageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function queryCallCounts(page: Page) {
  return page.evaluate(() => ({
    connection: (window.__browserloginMockCalls ?? []).filter(
      (call) => call.method === "connectionGet",
    ).length,
    binary: (window.__browserloginMockCalls ?? []).filter(
      (call) => call.method === "binaryStatus",
    ).length,
    profiles: (window.__browserloginMockCalls ?? []).filter(
      (call) => call.method === "profilesList",
    ).length,
    sessions: (window.__browserloginMockCalls ?? []).filter(
      (call) => call.method === "sessionsLive",
    ).length,
  }));
}

const routes = [
  ["Dashboard", "/dashboard"],
  ["Proxies", "/proxies"],
  ["Users", "/users"],
  ["Audit", "/audit"],
  ["Settings", "/settings"],
] as const;

test("renders all five routes with mock data and clean console", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/dashboard");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "BrowserLogin logo" }),
  ).toBeVisible();
  for (const [label, path] of routes) {
    await page.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
  }
  await page.goto("/profiles?multi=1#sessions");
  await expect(page).toHaveURL(/\/dashboard\?multi=1#sessions$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Live sessions" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Profiles" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sessions" })).toHaveCount(0);
  expect(errors).toEqual([]);
  const directory =
    process.env.BROWSERLOGIN_EVIDENCE_DIR ??
    join(process.cwd(), "test-results");
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, "app-shell.png"),
    fullPage: true,
  });
});

test("displays the BrowserLogin logo during first-run setup", async ({
  page,
}) => {
  // Given
  await page.goto("/dashboard?setup=1");

  // Then
  await expect(
    page.getByRole("img", { name: "BrowserLogin logo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Connect BrowserLogin" }),
  ).toBeVisible();
});

test("primary navigation and content are keyboard reachable", async ({
  page,
}) => {
  await page.goto("/dashboard?binaryStatusDelayMs=450");
  await expect(
    page.getByRole("complementary", { name: "Primary navigation" }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByRole("link", { name: "Settings" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("status refresh notification is announced and auto-dismisses", async ({
  page,
}) => {
  // Given
  await page.goto("/dashboard");

  // When
  await page.getByRole("button", { name: "Refresh status" }).click();

  // Then
  const status = page.getByRole("status", { name: "Status notification" });
  await expect(status).toHaveAttribute("data-state", "success");
  await expect(status).toHaveCount(0, { timeout: 6_000 });
});

test("status refresh awaits every active query and updates the remote profile", async ({
  page,
}) => {
  // Given
  const pageErrors = observePageErrors(page);
  await page.goto("/dashboard?profilesList=changed-after-first");
  await expect(
    page.getByText("Research profile", { exact: true }),
  ).toBeVisible();
  const before = await queryCallCounts(page);

  // When
  await page.getByRole("button", { name: "Refresh status" }).click();

  // Then
  const pending = page.locator('[data-state="pending"]');
  await expect(pending).toHaveAttribute("role", "status");
  await expect(page.getByRole("button", { name: "Refreshing" })).toBeDisabled();
  const success = page.locator('[data-state="success"]');
  await expect(success).toHaveAttribute("role", "status");
  await expect(
    page.getByText("Remote refreshed profile", { exact: true }),
  ).toBeVisible();
  const after = await queryCallCounts(page);
  expect(after).toEqual({
    connection: before.connection + 1,
    binary: before.binary + 1,
    profiles: before.profiles + 1,
    sessions: before.sessions + 1,
  });
  expect(pageErrors).toEqual([]);
});

test("status refresh reports a sanitized active-query failure", async ({
  page,
}) => {
  // Given
  const pageErrors = observePageErrors(page);
  await page.goto("/dashboard?profilesList=fail-after-first");
  await expect(
    page.getByText("Research profile", { exact: true }),
  ).toBeVisible();
  const before = await queryCallCounts(page);

  // When
  await page.getByRole("button", { name: "Refresh status" }).click();

  // Then
  const failure = page.locator('[data-state="error"]');
  await expect(failure).toHaveAttribute("role", "alert", { timeout: 15_000 });
  const failureText = await failure.textContent();
  const after = await queryCallCounts(page);
  expect(after.connection).toBe(before.connection + 1);
  expect(after.binary).toBe(before.binary + 1);
  expect(after.profiles).toBeGreaterThan(before.profiles);
  expect(after.sessions).toBe(before.sessions + 1);
  expect(failureText).not.toContain(refreshSecret);
  expect(failureText).not.toContain(refreshApiKey);
  expect(failureText).not.toContain(refreshUrl);
  expect(failureText).not.toContain(redactionMarker);
  expect(pageErrors).toEqual([]);
});

test("system dark mode keeps the light application surface", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/dashboard");
  await expect(page.getByText("No local sessions are running.")).toBeVisible();
  const background = await page
    .locator("body > div > div")
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  const oklch = background.match(/oklch\((\d+(?:\.\d+)?)/);
  if (oklch) expect(Number(oklch[1])).toBeGreaterThan(0.8);
  else {
    const rgb = background.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    expect(rgb).not.toBeNull();
    expect(Number(rgb![1]) + Number(rgb![2]) + Number(rgb![3])).toBeGreaterThan(
      600,
    );
  }
  const directory =
    process.env.BROWSERLOGIN_EVIDENCE_DIR ??
    join(process.cwd(), "test-results");
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, "light-theme-dark-system.png"),
    fullPage: true,
  });
});
