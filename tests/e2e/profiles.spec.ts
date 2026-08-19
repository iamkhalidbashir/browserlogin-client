import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const evidence =
  process.env.BROWSERLOGIN_EVIDENCE_DIR ?? join(process.cwd(), "test-results");

test("setup gate blocks navigation until connection succeeds", async ({
  page,
}) => {
  await page.goto("/?setup=1");
  await expect(
    page.getByRole("heading", { name: "Connect BrowserLogin" }),
  ).toBeVisible();
  await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: join(evidence, "task-27-setup.png"),
    fullPage: true,
  });
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await page.getByLabel("API key").fill("bl_test_key_value");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
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
    path: join(evidence, "task-27-editor.png"),
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
  await expect(page.getByRole("status")).toContainText("1 session started");
  const launchMethods = await page.evaluate(() =>
    window.__browserloginMockCalls?.map((call) => call.method),
  );
  expect(launchMethods).toEqual(
    expect.arrayContaining(["binaryStatus", "sessionsStart"]),
  );
  expect(launchMethods).not.toContain("binaryDownload");

  await page.getByLabel("Select Research profile").check();
  await page.getByRole("button", { name: "Launch selected" }).click();
  await expect(page.getByRole("status")).toContainText("1 session started");

  await page.getByRole("button", { name: "Delete Research profile" }).click();
  const deleteButton = page.getByRole("button", {
    name: "Delete",
    exact: true,
  });
  await expect(deleteButton).toBeDisabled();
  await page.getByLabel("Delete confirmation").fill("Research profile");
  await expect(deleteButton).toBeEnabled();
  await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: join(evidence, "task-27-profiles.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByText("profile-1", { exact: true })).toBeVisible();
  await page.screenshot({
    path: join(evidence, "task-27-launch.png"),
    fullPage: true,
  });
  const forceButton = page.getByRole("button", { name: "Force stop" });
  await expect(forceButton).toBeDisabled();
  await page
    .getByLabel("Force confirmation profile-1")
    .fill("FORCE CLOSE profile-1");
  await expect(forceButton).toBeEnabled();
  await forceButton.click();
  await expect(page.getByText("No local sessions are running.")).toBeVisible();
});

test("launch directs an uninitialized browser to Settings without downloading", async ({
  page,
}) => {
  await page.goto("/profiles?binary=missing");
  await page.getByRole("button", { name: "Launch", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Initialize it from Settings first",
  );
  await expect(
    page.getByRole("link", {
      name: "Open Settings to initialize CloakBrowser",
    }),
  ).toHaveAttribute("href", "/settings");
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
  const confirmInput = page.getByLabel("Delete confirmation");
  await expect(confirmInput).toBeVisible();
  await expect(page.locator("p", { hasText: "to confirm" })).toContainText(
    "Secondary profile",
  );
  const deleteButton = page.getByRole("button", {
    name: "Delete",
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

test("edit and restore target the selected profile row", async ({ page }) => {
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
  await row.getByRole("button", { name: "Restore" }).click();
  const restoreCall = await page.evaluate(() =>
    window.__browserloginMockCalls?.find(
      (call) => call.method === "profilesRestore",
    ),
  );
  expect(restoreCall?.params).toMatchObject({ profileId: "profile-2" });
});

test("edit sends optimistic version and surfaces 409 conflict", async ({
  page,
}) => {
  await page.goto("/profiles?conflict=1");
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
});
