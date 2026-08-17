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
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
  const connectionSet = await page.evaluate(() =>
    window.__browserloginMockCalls?.find(
      (call) => call.method === "connectionSet",
    ),
  );
  expect(connectionSet?.params).toMatchObject({
    apiKey: "bl_test_key_value",
  });

  // downloadDelayMs is a mock-only query param that slows binaryDownload
  // so the progress state stays visible long enough to screenshot.
  await page.goto("/profiles?downloadDelayMs=750");
  await expect(
    page.getByRole("button", { name: "Launch", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: join(evidence, "02-profiles.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Launch", exact: true }).click();
  await expect(
    page.getByText("Downloading and verifying…", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: join(evidence, "03-launch-download.png"),
    fullPage: true,
  });
  await expect(page.getByRole("status")).toContainText("1 session started");
  const methods = await page.evaluate(
    () => window.__browserloginMockCalls?.map((call) => call.method) ?? [],
  );
  const binaryStatusIndex = methods.indexOf("binaryStatus");
  const binaryDownloadIndex = methods.indexOf("binaryDownload");
  const sessionsStartIndex = methods.indexOf("sessionsStart");
  expect(binaryStatusIndex).toBeGreaterThanOrEqual(0);
  expect(binaryDownloadIndex).toBeGreaterThan(binaryStatusIndex);
  expect(sessionsStartIndex).toBeGreaterThan(binaryDownloadIndex);

  // Visible running session on the dashboard.
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByText("profile-1", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop and archive" }),
  ).toBeVisible();
  await page.screenshot({
    path: join(evidence, "04-running-session.png"),
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
    path: join(evidence, "05-stopped-session.png"),
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
