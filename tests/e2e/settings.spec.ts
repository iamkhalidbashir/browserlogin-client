import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const evidence =
  process.env.BROWSERLOGIN_EVIDENCE_DIR ?? join(process.cwd(), "test-results");

test("license is write-only and custom source requires explicit advanced consent", async ({
  page,
}) => {
  await page.goto("/settings");
  const license = page.getByLabel("License key");
  await license.fill("license-secret-value");
  await page.getByRole("button", { name: "Set license" }).click();
  await expect(license).toHaveValue("");
  await expect(
    page.getByText("Plan tier: Pro configured", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Install licensed release" }).click();
  await expect(page.locator("body")).not.toContainText("license-secret-value");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(
    page.getByText("Plan tier: Free", { exact: false }),
  ).toBeVisible();

  const custom = page.getByLabel("Custom URL");
  await expect(custom).toBeDisabled();
  await page
    .getByLabel("Advanced: I understand that custom sources are unverified.")
    .check();
  await custom.fill("http://downloads.example.test");
  await expect(page.getByRole("alert")).toContainText("Use HTTPS");
  await custom.fill("https://downloads.example.test");
  await page.getByRole("button", { name: "Save source" }).click();
  await page.getByRole("button", { name: "Install latest Free" }).click();
  await page.getByRole("button", { name: "Install from custom URL" }).click();
  const call = await page.evaluate(() =>
    window.__browserloginMockCalls?.find(
      (item) => item.method === "settingsSet",
    ),
  );
  expect(call?.params).toMatchObject({
    downloadSource: "custom",
    customDownloadUrl: "https://downloads.example.test",
    advancedEnabled: true,
  });
  const downloadCalls = await page.evaluate(() =>
    window.__browserloginMockCalls?.filter(
      (item) => item.method === "binaryDownload",
    ),
  );
  expect(downloadCalls?.map((item) => item.params)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: "license" }),
      expect.objectContaining({ source: "free" }),
      expect.objectContaining({
        source: "custom",
        customUrl: "https://downloads.example.test",
        advancedEnabled: true,
      }),
    ]),
  );
  await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: join(evidence, "task-29-settings.png"),
    fullPage: true,
  });
});

test("CLI, update states, logs, and disconnect use narrow RPC methods", async ({
  page,
}) => {
  await page.goto("/settings?update=available");
  await expect(
    page.getByText("browserlogin", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText('"mcp"', { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Install browserlogin CLI" }).click();
  await expect(page.getByRole("status")).toContainText("CLI not installed");
  await page.getByRole("button", { name: "Check now" }).click();
  await expect(
    page.getByText("Update available", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Download update" }).click();
  await expect(
    page.getByText("Ready to relaunch", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("No matching log lines.")).toBeVisible();
  const methods = await page.evaluate(() =>
    window.__browserloginMockCalls?.map((item) => item.method),
  );
  expect(methods).toEqual(
    expect.arrayContaining([
      "cliInstall",
      "updatesCheck",
      "updatesDownload",
      "logsTail",
    ]),
  );
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect BrowserLogin" }),
  ).toBeVisible();
});

test("failed connection save shows the error and never runs connectionTest", async ({
  page,
}) => {
  await page.goto("/settings?connectionSet=fail");
  const apiKey = page.getByLabel("Re-enter API key");
  await apiKey.fill("bl_test_fake_rejected_key");
  await page.getByRole("button", { name: "Save and test" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Connection save failed: mock rejection.",
  );
  await expect(page.locator("body")).not.toContainText(
    "bl_test_fake_rejected_key",
  );
  const methods = await page.evaluate(() =>
    window.__browserloginMockCalls?.map((item) => item.method),
  );
  expect(methods).toContain("connectionSet");
  expect(methods).not.toContain("connectionTest");
});

test("rejected connection save surfaces transport error and never runs connectionTest", async ({
  page,
}) => {
  await page.goto("/settings?connectionSet=reject");
  const apiKey = page.getByLabel("Re-enter API key");
  await apiKey.fill("bl_test_fake_transport_key");
  await page.getByRole("button", { name: "Save and test" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Connection request failed: mock transport rejection.",
  );
  await expect(page.locator("body")).not.toContainText(
    "bl_test_fake_transport_key",
  );
  const methods = await page.evaluate(() =>
    window.__browserloginMockCalls?.map((item) => item.method),
  );
  expect(methods).toContain("connectionSet");
  expect(methods).not.toContain("connectionTest");
});

test("saving the connection shows pending feedback inside the Connection panel", async ({
  page,
}) => {
  await page.goto("/settings?connectionSet=delay");
  const apiKey = page.getByLabel("Re-enter API key");
  await apiKey.fill("bl_test_fake_pending_key");
  const panel = page.locator("article.panel", {
    has: page.getByRole("heading", { name: "Connection" }),
  });
  await page.getByRole("button", { name: "Save and test" }).click();
  await expect(panel.getByRole("status")).toContainText("Saving connection…");
  await expect(apiKey).toHaveValue("");
  await expect(page.locator("body")).not.toContainText(
    "bl_test_fake_pending_key",
  );
  const methods = await page.evaluate(() =>
    window.__browserloginMockCalls?.map((item) => item.method),
  );
  expect(methods).toContain("connectionSet");
  expect(methods).toContain("connectionTest");
});

test("successful connection save clears the key and refreshes connection reads", async ({
  page,
}) => {
  await page.goto("/settings");
  const apiKey = page.getByLabel("Re-enter API key");
  await apiKey.fill("bl_test_fake_accepted_key");
  await page.getByRole("button", { name: "Save and test" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Connection verified.",
  );
  await expect(apiKey).toHaveValue("");
  await expect(page.locator("body")).not.toContainText(
    "bl_test_fake_accepted_key",
  );
  await expect
    .poll(async () => {
      const calls = await page.evaluate(
        () => window.__browserloginMockCalls ?? [],
      );
      const savedAt = calls.findIndex(
        (item) => item.method === "connectionSet",
      );
      return calls
        .slice(savedAt + 1)
        .filter((item) => item.method === "connectionGet").length;
    })
    .toBe(2);
  const methods = await page.evaluate(() =>
    window.__browserloginMockCalls?.map((item) => item.method),
  );
  expect(methods).toContain("connectionTest");
});

test("failed connection test preserves the successfully saved application origin", async ({
  page,
}) => {
  // Given
  await page.goto("/settings?connectionTest=fail");
  const origin = page.getByLabel("Application origin");
  const apiKey = page.getByLabel("Re-enter API key");
  await origin.fill("https://saved.example.test");
  await apiKey.fill("bl_test_fake_saved_key");

  // When
  await page.getByRole("button", { name: "Save and test" }).click();

  // Then
  await expect(page.getByRole("status")).toContainText(
    "Connection test failed.",
  );
  await expect(origin).toHaveValue("https://saved.example.test");
  await expect(apiKey).toHaveValue("");
  const calls = await page.evaluate(() => window.__browserloginMockCalls ?? []);
  const savedAt = calls.findIndex((item) => item.method === "connectionSet");
  const testedAt = calls.findIndex((item) => item.method === "connectionTest");
  expect(savedAt).toBeGreaterThanOrEqual(0);
  expect(testedAt).toBeGreaterThan(savedAt);
  expect(
    calls
      .slice(savedAt + 1, testedAt)
      .some((item) => item.method === "connectionGet"),
  ).toBe(true);
});
