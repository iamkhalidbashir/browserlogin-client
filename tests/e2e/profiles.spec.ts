import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const evidence =
  process.env.BROWSERLOGIN_EVIDENCE_DIR ?? join(process.cwd(), "test-results");
const launchSecret = "launch-secret";
const launchApiKey = "bl_launch_secret";
const launchUrl = "https://private.example.test/launch";
const redactionMarker = "<redacted>";

function observePageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("setup gate blocks navigation until connection and runtime setup succeed", async ({
  page,
}) => {
  // Given
  await page.goto(
    "/?setup=1&binary=missing&downloadDelayMs=2000&binaryProgressDelayMs=500",
  );
  await expect(
    page.getByRole("heading", { name: "Connect BrowserLogin" }),
  ).toBeVisible();
  await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: join(evidence, "connection-setup.png"),
    fullPage: true,
  });
  await expect(page.getByRole("navigation")).toHaveCount(0);

  // When
  await page.getByLabel("API key").fill("bl_test_key_value");
  await page.getByRole("button", { name: "Save and test" }).click();

  // Then
  await expect(page.getByLabel("License key")).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);

  // When
  await page.getByLabel("License key").fill("license-test-key");
  await page.getByRole("button", { name: "Install CloakBrowser" }).click();

  // Then
  const progress = page.getByRole("progressbar");
  await expect(progress).toBeVisible();
  await expect(progress).not.toHaveAttribute("value");
  await expect(progress).toHaveAttribute("value", /\d+/);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("license-test-key");
  const calls = await page.evaluate(() => window.__browserloginMockCalls ?? []);
  const savedConnectionAt = calls.findIndex(
    (item) => item.method === "connectionSet",
  );
  const savedLicenseAt = calls.findIndex(
    (item) => item.method === "licenseSet",
  );
  const downloadedAt = calls.findIndex(
    (item) => item.method === "binaryDownload",
  );
  expect(savedConnectionAt).toBeGreaterThanOrEqual(0);
  expect(savedLicenseAt).toBeGreaterThan(savedConnectionAt);
  expect(downloadedAt).toBeGreaterThan(savedLicenseAt);
  expect(calls[savedConnectionAt]?.params).toEqual({
    appOrigin: "https://example-1.app-csite-env.sapps.co",
    apiKey: "[REDACTED]",
  });
  expect(calls[savedLicenseAt]?.params).toEqual({
    licenseKey: "[REDACTED]",
  });
  expect(calls[downloadedAt]?.params).toEqual({
    advancedEnabled: false,
    source: "license",
  });
  expect(calls.some((item) => item.method === "binaryProgress")).toBe(true);
});

test("failed runtime download stays gated and retries without storing the license again", async ({
  page,
}) => {
  // Given
  await page.goto("/?setup=1&binary=missing&binaryDownload=fail");
  await page.getByLabel("API key").fill("bl_test_key_value");
  await page.getByRole("button", { name: "Save and test" }).click();
  await page.getByLabel("License key").fill("license-test-key");

  // When
  await page.getByRole("button", { name: "Install CloakBrowser" }).click();

  // Then
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByLabel("License key")).toHaveCount(0);
  const retry = page.getByRole("button", { name: "Retry download" });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "CloakBrowser download failed",
  );

  // When
  await retry.click();

  // Then
  const calls = await page.evaluate(() => window.__browserloginMockCalls ?? []);
  expect(calls.filter((item) => item.method === "licenseSet")).toHaveLength(1);
  expect(calls.filter((item) => item.method === "binaryDownload")).toHaveLength(
    2,
  );
  await expect(page.getByRole("navigation")).toHaveCount(0);
});

test("pending runtime status never exposes the application shell", async ({
  page,
}) => {
  // Given
  await page.goto("/dashboard?binaryStatusDelayMs=450");

  // Then
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Install CloakBrowser" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toBeVisible();
});

test("rejected connection test after a successful save keeps the saved connection and re-enables Save and test", async ({
  page,
}) => {
  // Given: setup gate with a stale post-save read so SetupView stays mounted.
  await page.goto("/?setup=1&connectionGet=stale&connectionTest=reject");
  const origin = page.getByLabel("Application origin");
  const apiKey = page.getByLabel("API key");
  const saveButton = page.getByRole("button", { name: "Save and test" });
  await apiKey.fill("bl_test_fake_rejected_test_key");

  // When
  await saveButton.click();

  // Then: the rejection surfaces without undoing the persisted connection.
  await expect(page.getByRole("status")).toContainText(
    "Connection test failed: mock transport rejection.",
  );
  await expect(origin).toHaveValue("https://example-1.app-csite-env.sapps.co");
  await expect(apiKey).toHaveValue("");
  await expect(page.locator("body")).not.toContainText(
    "bl_test_fake_rejected_test_key",
  );
  const calls = await page.evaluate(() => window.__browserloginMockCalls ?? []);
  const savedAt = calls.findIndex((item) => item.method === "connectionSet");
  const testedAt = calls.findIndex((item) => item.method === "connectionTest");
  expect(savedAt).toBeGreaterThanOrEqual(0);
  expect(testedAt).toBeGreaterThan(savedAt);
  expect(calls[savedAt]?.params).toMatchObject({
    appOrigin: "https://example-1.app-csite-env.sapps.co",
    apiKey: "[REDACTED]",
  });
  await expect(saveButton).toBeVisible();
  await apiKey.fill("bl_test_fake_retry_key");
  await expect(saveButton).toBeEnabled();
});

test("creates, launches, multi-selects, and protects deletion", async ({
  page,
}) => {
  await page.goto("/profiles");
  await page.getByRole("button", { name: "Create profile" }).click();
  await page
    .getByRole("dialog", { name: "Create profile" })
    .getByLabel("Name")
    .fill("Created profile");
  await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: join(evidence, "profile-editor.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const createCall = await page.evaluate(() =>
    window.__browserloginMockCalls?.find(
      (call) => call.method === "profilesCreate",
    ),
  );
  expect(createCall?.params).toMatchObject({
    name: "Created profile",
    platform: "macos",
    geoip: true,
    humanize: true,
    human_preset: "careful",
    bumblebee_profile: "natural",
  });

  await page.getByRole("button", { name: "Launch", exact: true }).click();
  await expect(page.getByText("profile-1", { exact: true })).toBeVisible();
  const launchMethods = await page.evaluate(() =>
    window.__browserloginMockCalls?.map((call) => call.method),
  );
  expect(launchMethods).toEqual(
    expect.arrayContaining(["binaryStatus", "sessionsStart"]),
  );
  expect(launchMethods).not.toContain("binaryDownload");

  await page.getByLabel("Select Research profile").check();
  await page.getByRole("button", { name: "Launch selected" }).click();
  await expect(page.getByText("profile-1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Delete Research profile" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete profile" });
  const deleteButton = deleteDialog.getByRole("button", {
    name: "Delete profile",
    exact: true,
  });
  await expect(deleteButton).toBeDisabled();
  await deleteDialog.getByLabel("Delete confirmation").fill("Research profile");
  await expect(deleteButton).toBeEnabled();
  await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: join(evidence, "profiles-list.png"),
    fullPage: true,
  });
  await deleteDialog
    .getByRole("button", { name: "Close Delete profile" })
    .click();
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByText("profile-1", { exact: true })).toBeVisible();
  await page.screenshot({
    path: join(evidence, "profile-launch.png"),
    fullPage: true,
  });
  const liveSession = page
    .locator("article.session-row")
    .filter({ hasText: "profile-1" });
  await liveSession.getByRole("button", { name: "Force stop" }).click();
  const forceDialog = page.getByRole("dialog", {
    name: "Force stop profile",
  });
  const forceButton = forceDialog.getByRole("button", {
    name: "Force stop profile-1",
  });
  await expect(forceButton).toBeDisabled();
  await forceDialog
    .getByLabel("Force confirmation profile-1")
    .fill("FORCE CLOSE profile-1");
  await expect(forceButton).toBeEnabled();
  await forceButton.click();
  await expect(page.getByText("No local sessions are running.")).toBeVisible();
});

test("direct profile navigation stays gated when the runtime is missing", async ({
  page,
}) => {
  // Given
  await page.goto("/profiles?binary=missing");

  // Then
  await expect(
    page.getByRole("heading", { name: "Install CloakBrowser" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: join(evidence, "profiles-binary-required.png"),
    fullPage: true,
  });
  const methods = await page.evaluate(() =>
    window.__browserloginMockCalls?.map((call) => call.method),
  );
  expect(methods).toContain("binaryStatus");
  expect(methods).not.toContain("binaryDownload");
  expect(methods).not.toContain("sessionsStart");
});

test("editor lists real proxies and saves the selected proxy", async ({
  page,
}) => {
  await page.goto("/profiles?multi=1");
  const row = page.getByRole("row", { name: /Secondary profile/ });
  await row.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit profile" });
  const proxySelect = dialog.getByLabel("Proxy");
  await expect(proxySelect.locator("option", { hasText: "Local" })).toHaveCount(
    1,
  );
  await expect(
    proxySelect.locator("option", { hasText: "Backup" }),
  ).toHaveCount(1);
  await proxySelect.selectOption({ label: "Backup" });
  await dialog.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const updateCall = await page.evaluate(() =>
    window.__browserloginMockCalls?.find(
      (call) => call.method === "profilesUpdate",
    ),
  );
  expect(updateCall?.params).toMatchObject({
    profileId: "profile-2",
    proxy_id: "proxy-2",
  });
});

test("delete targets the explicitly chosen row and clears after success", async ({
  page,
}) => {
  await page.goto("/profiles?multi=1");
  await page.getByRole("button", { name: "Delete Secondary profile" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete profile" });
  const confirmInput = deleteDialog.getByLabel("Delete confirmation");
  await expect(confirmInput).toBeVisible();
  await expect(
    deleteDialog.locator("p", { hasText: "to confirm" }),
  ).toContainText("Secondary profile");
  const deleteButton = deleteDialog.getByRole("button", {
    name: "Delete profile",
    exact: true,
  });
  await expect(deleteButton).toBeDisabled();
  await confirmInput.fill("Secondary profile");
  await expect(deleteButton).toBeEnabled();
  const listsBefore =
    (await page.evaluate(
      () =>
        window.__browserloginMockCalls?.filter(
          (call) => call.method === "profilesList",
        ).length,
    )) ?? 0;
  await deleteButton.click();
  await expect(confirmInput).toHaveCount(0);
  const calls = (await page.evaluate(
    () => window.__browserloginMockCalls ?? [],
  )) as Array<{ method: string; params: unknown }>;
  const deleteCall = calls.find((call) => call.method === "profilesDelete");
  expect(deleteCall?.params).toMatchObject({ profileId: "profile-2" });
  const listsAfter = calls.filter(
    (call) => call.method === "profilesList",
  ).length;
  expect(listsAfter).toBeGreaterThan(listsBefore);
});

test("edit targets the selected profile row and active profiles have no restore action", async ({
  page,
}) => {
  await page.goto("/profiles?multi=1");
  const row = page.getByRole("row", { name: /Secondary profile/ });
  await row.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit profile" });
  await expect(dialog.getByLabel("Name")).toHaveValue("Secondary profile");
  await dialog.getByLabel("Name").fill("Secondary renamed");
  await dialog.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const updateCall = await page.evaluate(() =>
    window.__browserloginMockCalls?.find(
      (call) => call.method === "profilesUpdate",
    ),
  );
  expect(updateCall?.params).toMatchObject({
    profileId: "profile-2",
    expectedConfigVersion: 0,
    name: "Secondary renamed",
  });
  await expect(page.getByRole("button", { name: "Restore" })).toHaveCount(0);
  const restoreCalls = await page.evaluate(() =>
    (window.__browserloginMockCalls ?? []).filter(
      (call) => call.method === "profilesRestore",
    ),
  );
  expect(restoreCalls).toHaveLength(0);
});

test("profile row rotates its assigned proxy and handles an unverified result", async ({
  page,
}) => {
  // Given
  await page.goto("/profiles?profileProxy=1&rotateUnverified=1");
  const row = page.getByRole("row", { name: /Research profile/ });

  // When
  await row.getByRole("button", { name: "Rotate IP" }).click();

  // Then
  const rotateCall = await page.evaluate(() =>
    window.__browserloginMockCalls?.find(
      (call) => call.method === "proxiesChangeIp",
    ),
  );
  expect(rotateCall?.params).toMatchObject({ proxyId: "proxy-1" });
});

test("only the selected profile action is pending while a slow request runs", async ({
  page,
}) => {
  // Given
  await page.goto("/profiles?multi=1&profileActionDelayMs=700");
  const firstRow = page.getByRole("row", { name: /Research profile/ });
  const secondRow = page.getByRole("row", { name: /Secondary profile/ });

  // When
  await firstRow.getByRole("button", { name: "Launch" }).click();

  // Then
  await expect(
    firstRow.getByRole("button", { name: "Launching…" }),
  ).toBeDisabled();
  await expect(firstRow.getByRole("button", { name: "Edit" })).toBeDisabled();
  await expect(secondRow.getByRole("button", { name: "Launch" })).toBeEnabled();
  await expect(
    firstRow.getByRole("button", { name: "Stop", exact: true }),
  ).toBeEnabled();
});

test("profile launch exposes pending then successful machine-readable feedback", async ({
  page,
}) => {
  // Given
  const pageErrors = observePageErrors(page);
  await page.goto("/profiles?profileActionDelayMs=700");

  // When
  await page.getByRole("button", { name: "Launch", exact: true }).click();

  // Then
  const pending = page.locator('[data-state="pending"]');
  await expect(pending).toHaveAttribute("role", "status");
  await expect(pending).toHaveAttribute("data-code", "");
  await expect(pending).toHaveAttribute("data-completed", "0");
  const success = page.locator('[data-state="success"]');
  await expect(success).toHaveAttribute("role", "status");
  await expect(success).toHaveAttribute("data-code", "");
  await expect(success).toHaveAttribute("data-completed", "1");
  const methods = await page.evaluate(() =>
    (window.__browserloginMockCalls ?? []).map((call) => call.method),
  );
  const startedAt = methods.lastIndexOf("sessionsStart");
  const preflightAt = methods.lastIndexOf("binaryStatus", startedAt - 1);
  expect(preflightAt).toBeGreaterThanOrEqual(0);
  expect(startedAt).toBeGreaterThan(preflightAt);
  expect(pageErrors).toEqual([]);
});

test("profile launch surfaces a sanitized RPC reply failure", async ({
  page,
}) => {
  // Given
  const pageErrors = observePageErrors(page);
  await page.goto("/profiles?sessionsStart=fail");

  // When
  await page.getByRole("button", { name: "Launch", exact: true }).click();

  // Then
  const feedback = page.locator('[data-state="error"]');
  await expect(feedback).toHaveAttribute("role", "alert");
  await expect(feedback).toHaveAttribute("data-code", "SESSION_START_FAILED");
  await expect(feedback).toHaveAttribute("data-completed", "0");
  await expect(page.locator("body")).not.toContainText(launchSecret);
  await expect(page.locator("body")).not.toContainText(launchApiKey);
  await expect(page.locator("body")).not.toContainText(launchUrl);
  await expect(page.locator("body")).not.toContainText(redactionMarker);
  expect(pageErrors).toEqual([]);
});

test("profile launch surfaces a sanitized transport rejection", async ({
  page,
}) => {
  // Given
  const pageErrors = observePageErrors(page);
  await page.goto("/profiles?sessionsStart=reject");

  // When
  await page.getByRole("button", { name: "Launch", exact: true }).click();

  // Then
  const feedback = page.locator('[data-state="error"]');
  await expect(feedback).toHaveAttribute("role", "alert");
  await expect(feedback).toHaveAttribute("data-code", "TRANSPORT_ERROR");
  await expect(feedback).toHaveAttribute("data-completed", "0");
  await expect(page.locator("body")).not.toContainText(launchSecret);
  await expect(page.locator("body")).not.toContainText(launchApiKey);
  await expect(page.locator("body")).not.toContainText(launchUrl);
  await expect(page.locator("body")).not.toContainText(redactionMarker);
  expect(pageErrors).toEqual([]);
});

test("profile launch rechecks a runtime that disappears after the app gate", async ({
  page,
}) => {
  // Given
  const pageErrors = observePageErrors(page);
  await page.goto("/profiles?binaryStatus=missing-after-first");

  // When
  await page.getByRole("button", { name: "Launch", exact: true }).click();

  // Then
  const feedback = page.locator('[data-state="error"]');
  await expect(feedback).toHaveAttribute("role", "alert");
  await expect(feedback).toHaveAttribute("data-code", "RUNTIME_REQUIRED");
  await expect(feedback).toHaveAttribute("data-completed", "0");
  const starts = await page.evaluate(
    () =>
      (window.__browserloginMockCalls ?? []).filter(
        (call) => call.method === "sessionsStart",
      ).length,
  );
  expect(starts).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("partial batch launch refreshes profiles and sessions after the first success", async ({
  page,
}) => {
  // Given
  const pageErrors = observePageErrors(page);
  await page.goto("/profiles?multi=1&sessionsStart=fail-profile-2");
  await page.getByLabel("Select Research profile").check();
  await page.getByLabel("Select Secondary profile").check();
  const callsBefore = await page.evaluate(() => [
    (window.__browserloginMockCalls ?? []).filter(
      (call) => call.method === "profilesList",
    ).length,
    (window.__browserloginMockCalls ?? []).filter(
      (call) => call.method === "sessionsLive",
    ).length,
  ]);

  // When
  await page.getByRole("button", { name: "Launch selected" }).click();

  // Then
  const feedback = page.locator('[data-state="error"]');
  await expect(feedback).toHaveAttribute("role", "alert");
  await expect(feedback).toHaveAttribute("data-code", "SESSION_START_FAILED");
  await expect(feedback).toHaveAttribute("data-completed", "1");
  await expect(page.getByText("profile-1", { exact: true })).toBeVisible();
  const callsAfter = await page.evaluate(() => ({
    profiles: (window.__browserloginMockCalls ?? []).filter(
      (call) => call.method === "profilesList",
    ).length,
    sessions: (window.__browserloginMockCalls ?? []).filter(
      (call) => call.method === "sessionsLive",
    ).length,
    starts: (window.__browserloginMockCalls ?? [])
      .filter((call) => call.method === "sessionsStart")
      .map((call) => call.params),
  }));
  expect(callsAfter.profiles).toBeGreaterThan(callsBefore[0] ?? 0);
  expect(callsAfter.sessions).toBeGreaterThan(callsBefore[1] ?? 0);
  expect(callsAfter.starts).toEqual([
    { profileId: "profile-1" },
    { profileId: "profile-2" },
  ]);
  await expect(page.locator("body")).not.toContainText(launchSecret);
  await expect(page.locator("body")).not.toContainText(launchApiKey);
  await expect(page.locator("body")).not.toContainText(launchUrl);
  await expect(page.locator("body")).not.toContainText(redactionMarker);
  expect(pageErrors).toEqual([]);
});

test("profile table normal Stop preserves the archive-producing lifecycle", async ({
  page,
}) => {
  // Given
  await page.goto("/profiles?profileRunning=1");
  const row = page.getByRole("row", { name: /Research profile/ });

  // When: the normal lifecycle action is used.
  await row.getByRole("button", { name: "Stop", exact: true }).click();

  // Then: it preserves the existing archive-producing RPC contract.
  const normalStop = await page.evaluate(() =>
    window.__browserloginMockCalls?.find(
      (call) => call.method === "sessionsStop",
    ),
  );
  expect(normalStop?.params).toEqual({ profileId: "profile-1" });
});

test("profile table Force stop requires the exact confirmation phrase", async ({
  page,
}) => {
  // Given
  await page.goto("/profiles?profileRunning=1");
  const runningRow = page.getByRole("row", { name: /Research profile/ });
  await runningRow.getByRole("button", { name: "Force stop" }).click();
  const confirmationDialog = page.getByRole("dialog", {
    name: "Force stop profile",
  });
  const confirmation = confirmationDialog.getByLabel(
    "Force confirmation profile-1",
  );
  const confirmButton = confirmationDialog.getByRole("button", {
    name: "Force stop profile-1",
  });
  await expect(confirmButton).toBeDisabled();

  // When: a near miss is entered, followed by the exact confirmation.
  await confirmation.fill("FORCE CLOSE PROFILE-1");
  await expect(confirmButton).toBeDisabled();
  await confirmation.fill("FORCE CLOSE profile-1");
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  // Then: only the confirmed destructive RPC is sent.
  const forceStops = await page.evaluate(() =>
    window.__browserloginMockCalls?.filter(
      (call) => call.method === "sessionsForceStop",
    ),
  );
  expect(forceStops).toEqual([
    {
      method: "sessionsForceStop",
      params: {
        profileId: "profile-1",
        confirmation: "FORCE CLOSE profile-1",
      },
    },
  ]);
});

test("dashboard keeps sessions visible without profile activity", async ({
  page,
}) => {
  // Given
  await page.goto("/profiles?binaryStatusDelayMs=450&profileActionDelayMs=450");

  // When
  await page.getByRole("button", { name: "Launch", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Live sessions" }),
  ).toBeVisible();
  await expect(page.getByText("Profile activity")).toHaveCount(0);
  await expect(page.getByText("profile-1", { exact: true })).toBeVisible();
});

test("edit sends optimistic version and surfaces 409 conflict", async ({
  page,
}) => {
  await page.goto("/profiles?conflict=1&profilesList=changed-after-first");
  await page.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit profile" });
  await dialog.getByLabel("Name").fill("Concurrent edit");
  await dialog.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Profile changed remotely",
  );
  const updateCall = await page.evaluate(() =>
    window.__browserloginMockCalls?.find(
      (call) => call.method === "profilesUpdate",
    ),
  );
  expect(updateCall?.params).toMatchObject({
    profileId: "profile-1",
    expectedConfigVersion: 0,
    name: "Concurrent edit",
  });
  await page.getByRole("button", { name: "Reload latest" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByLabel("Name")).toHaveValue(
    "Remote refreshed profile",
  );
});
