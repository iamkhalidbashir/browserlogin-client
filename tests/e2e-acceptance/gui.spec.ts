import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const evidence = join(
  process.env.BROWSERLOGIN_EVIDENCE_DIR ?? join(process.cwd(), "test-results"),
  "gui",
);

test("renderer GUI acceptance: setup, profiles, launch, stop", async ({
  page,
}) => {
  await mkdir(evidence, { recursive: true });

  // Setup navigation gating with a synthetic key only.
  await page.goto("/?setup=1");
  await expect(
    page.getByRole("heading", { name: "Connect BrowserLogin" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await page.screenshot({
    path: join(evidence, "01-setup-gated.png"),
    fullPage: true,
  });
  await page.getByLabel("API key").fill("bl_test_key_value");
  await page.getByRole("button", { name: "Save and test" }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
  const connectionSet = await page.evaluate(() =>
    window.__browserloginMockCalls?.find(
      (call) => call.method === "connectionSet",
    ),
  );
  expect(connectionSet?.params).toMatchObject({
    apiKey: "bl_test_key_value",
  });

  await page.goto("/profiles?binary=missing");
  await expect(
    page.getByRole("button", { name: "Launch", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: join(evidence, "02-profiles.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Launch", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Initialize it from Settings first",
  );
  await expect(
    page.getByRole("link", {
      name: "Open Settings to initialize CloakBrowser",
    }),
  ).toBeVisible();
  await page.screenshot({
    path: join(evidence, "03-launch-requires-init.png"),
    fullPage: true,
  });

  await page.goto("/settings?downloadDelayMs=750");
  await page.getByRole("button", { name: "Install latest Free" }).click();
  await expect(page.getByRole("status")).toContainText("installed and active");
  const initializationMethods = await page.evaluate(
    () => window.__browserloginMockCalls?.map((call) => call.method) ?? [],
  );
  expect(initializationMethods).toContain("binaryDownload");
  await page.screenshot({
    path: join(evidence, "04-browser-initialized.png"),
    fullPage: true,
  });

  await page.goto("/profiles");
  await page.getByRole("button", { name: "Launch", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("1 session started");
  const methods = await page.evaluate(
    () => window.__browserloginMockCalls?.map((call) => call.method) ?? [],
  );
  const binaryStatusIndex = methods.indexOf("binaryStatus");
  const sessionsStartIndex = methods.indexOf("sessionsStart");
  expect(binaryStatusIndex).toBeGreaterThanOrEqual(0);
  expect(methods).not.toContain("binaryDownload");
  expect(sessionsStartIndex).toBeGreaterThan(binaryStatusIndex);

  // Visible running session on the dashboard.
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByText("profile-1", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop and archive" }),
  ).toBeVisible();
  await page.screenshot({
    path: join(evidence, "05-running-session.png"),
    fullPage: true,
  });

  // Normal stop (not force stop) archives and clears local sessions.
  await page.getByRole("button", { name: "Stop and archive" }).click();
  await expect(page.getByText("No local sessions are running.")).toBeVisible();
  const stopCall = await page.evaluate(() =>
    window.__browserloginMockCalls?.find(
      (call) => call.method === "sessionsStop",
    ),
  );
  expect(stopCall?.params).toMatchObject({ profileId: "profile-1" });
  await page.screenshot({
    path: join(evidence, "06-stopped-session.png"),
    fullPage: true,
  });

  // Honest driver/surface declaration: Playwright drives the Vite dev:web
  // page in Chromium, not the native Electrobun WebView.
  await writeFile(
    join(evidence, "renderer-proof.json"),
    JSON.stringify(
      {
        driver: "Playwright",
        surface: "dev:web",
        playwright_controls_webview: false,
      },
      null,
      2,
    ) + "\n",
  );
});

test("session force-close confirmation and pending state are isolated per row", async ({
  page,
}) => {
  await page.goto("/profiles?multi=1");
  const launchButtons = page.getByRole("button", {
    name: "Launch",
    exact: true,
  });
  await launchButtons.nth(0).click();
  await launchButtons.nth(1).click();
  await page.getByRole("link", { name: "Dashboard" }).click();

  const firstInput = page.getByLabel("Force confirmation profile-1");
  const secondInput = page.getByLabel("Force confirmation profile-2");
  const forceButtons = page.getByRole("button", { name: "Force stop" });

  await firstInput.fill("FORCE CLOSE profile-1");
  await expect(forceButtons.nth(0)).toBeEnabled();
  await expect(forceButtons.nth(1)).toBeDisabled();

  await secondInput.fill("FORCE CLOSE profile-2");
  await expect(firstInput).toHaveValue("FORCE CLOSE profile-1");
  await expect(secondInput).toHaveValue("FORCE CLOSE profile-2");
  await expect(forceButtons.nth(0)).toBeEnabled();
  await expect(forceButtons.nth(1)).toBeEnabled();

  await forceButtons.nth(0).click();
  await expect(page.getByText("profile-1", { exact: true })).toHaveCount(0);
  await expect(page.getByText("profile-2", { exact: true })).toBeVisible();
  await expect(secondInput).toHaveValue("FORCE CLOSE profile-2");
  const forceCalls = await page.evaluate(() =>
    window.__browserloginMockCalls?.filter(
      (call) => call.method === "sessionsForceStop",
    ),
  );
  expect(forceCalls).toEqual([
    {
      method: "sessionsForceStop",
      params: {
        profileId: "profile-1",
        confirmation: "FORCE CLOSE profile-1",
      },
    },
  ]);
});
