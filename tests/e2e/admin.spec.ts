import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const evidence =
  process.env.BROWSERLOGIN_EVIDENCE_DIR ?? join(process.cwd(), "test-results");

test("proxy create and change-ip never render the password", async ({
  page,
}) => {
  await page.goto("/proxies");
  await page.getByRole("button", { name: "Add proxy" }).click();
  const dialog = page.getByRole("dialog", { name: "Create proxy" });
  await dialog.getByLabel("Name", { exact: true }).fill("Created proxy");
  await dialog.getByLabel("Host", { exact: true }).fill("proxy.example.test");
  await dialog.getByLabel("Username", { exact: true }).fill("proxy-user");
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("proxy-password-secret");
  await dialog.getByRole("button", { name: "Save proxy" }).click();
  await expect(page.getByRole("status")).toContainText("Proxy saved");
  await expect(page.locator("body")).not.toContainText("proxy-password-secret");
  const call = await page.evaluate(() =>
    window.__browserloginMockCalls?.find(
      (item) => item.method === "proxiesCreate",
    ),
  );
  expect(call?.params).toMatchObject({
    name: "Created proxy",
    protocol: "http",
    host: "proxy.example.test",
    username: "proxy-user",
    password: "proxy-password-secret",
  });
  await page.getByRole("button", { name: "Change IP" }).click();
  await expect(page.getByRole("status")).toContainText("203.0.113.10");
  await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: join(evidence, "task-28-proxies.png"),
    fullPage: true,
  });
});

test("proxy update targets the selected proxy row", async ({ page }) => {
  await page.goto("/proxies?multi=1");
  const row = page.getByRole("row", { name: /Backup/ });
  await row.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit proxy" });
  await expect(dialog.getByLabel("Host", { exact: true })).toHaveValue(
    "10.0.0.2",
  );
  await dialog.getByLabel("Host", { exact: true }).fill("backup.example.test");
  await dialog.getByRole("button", { name: "Save proxy" }).click();
  await expect(page.getByRole("status")).toContainText("Proxy saved");
  const call = await page.evaluate(() =>
    window.__browserloginMockCalls?.find(
      (item) => item.method === "proxiesUpdate",
    ),
  );
  expect(call?.params).toMatchObject({
    proxyId: "proxy-2",
    name: "Backup",
    protocol: "socks5",
    host: "backup.example.test",
    port: 1080,
  });
});

test("user and member actions target the selected rows and profile", async ({
  page,
}) => {
  await page.goto("/users?multi=1");
  await page
    .getByLabel("Members profile")
    .selectOption({ label: "Secondary profile" });
  const memberRow = page.getByRole("row", { name: /Second member/ });
  await memberRow.getByRole("button", { name: "Disable user" }).click();
  await expect(page.getByRole("alert")).toContainText("Second member");
  await expect(page.getByRole("alert")).toContainText(
    "force-stops all of their active sessions",
  );
  await page.getByRole("button", { name: "Confirm disable" }).click();
  await expect(page.getByRole("status")).toContainText("User disabled");
  await page.getByLabel("Share user").selectOption({ label: "Second member" });
  await page.getByRole("button", { name: "Share profile" }).click();
  await expect(page.getByRole("status")).toContainText("Profile shared");
  await page.getByRole("button", { name: "Remove" }).click();
  const calls = (await page.evaluate(
    () => window.__browserloginMockCalls ?? [],
  )) as Array<{ method: string; params: unknown }>;
  const paramsOf = (method: string) =>
    calls.find((item) => item.method === method)?.params as Record<
      string,
      unknown
    >;
  expect(paramsOf("usersDisable")).toMatchObject({ userId: "user-2" });
  expect(paramsOf("membersShare")).toMatchObject({
    profileId: "profile-2",
    userId: "user-2",
    role: "viewer",
  });
  expect(
    calls.some(
      (item) =>
        item.method === "membersList" &&
        (item.params as { profileId?: string }).profileId === "profile-2",
    ),
  ).toBe(true);
  expect(paramsOf("membersRemove")).toMatchObject({
    profileId: "profile-2",
    userId: "member-1",
  });
});

test("notes and history follow the selected profile", async ({ page }) => {
  await page.goto("/audit?multi=1");
  await page
    .getByLabel("Notes profile")
    .selectOption({ label: "Secondary profile" });
  await page.getByLabel("Profile notes").fill("Secondary profile note");
  await page.getByRole("button", { name: "Save notes" }).click();
  await expect(page.getByRole("status")).toContainText("version 2");
  const calls = (await page.evaluate(
    () => window.__browserloginMockCalls ?? [],
  )) as Array<{ method: string; params: unknown }>;
  for (const method of ["notesGet", "notesHistory", "notesAppend"]) {
    expect(
      calls.some(
        (item) =>
          item.method === method &&
          (item.params as { profileId?: string }).profileId === "profile-2",
      ),
    ).toBe(true);
  }
  const append = calls.find((item) => item.method === "notesAppend")
    ?.params as Record<string, unknown>;
  expect(append).toMatchObject({
    profileId: "profile-2",
    notes: "Secondary profile note",
    expectedVersion: 1,
  });
});

test("owner controls users and profile members with consequence confirmation", async ({
  page,
}) => {
  await page.goto("/users");
  await page.getByRole("button", { name: "Disable user" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "force-stops all of their active sessions",
  );
  await page.getByRole("button", { name: "Confirm disable" }).click();
  await expect(page.getByRole("status")).toContainText("User disabled");
  await page.getByLabel("Share role").selectOption("editor");
  await page.getByRole("button", { name: "Share profile" }).click();
  await expect(page.getByRole("status")).toContainText("Profile shared");
  await page.getByRole("button", { name: "Remove" }).click();
  const methods = await page.evaluate(() =>
    window.__browserloginMockCalls?.map((item) => item.method),
  );
  expect(methods).toEqual(
    expect.arrayContaining(["usersDisable", "membersShare", "membersRemove"]),
  );
});

test("notes save/history and audit filtering are version-aware", async ({
  page,
}) => {
  await page.goto("/audit");
  await page.getByLabel("Audit profile filter").fill("profile-1");
  await expect
    .poll(async () =>
      page.evaluate(() =>
        window.__browserloginMockCalls?.some(
          (item) =>
            item.method === "auditList" &&
            (item.params as { profileId?: string }).profileId === "profile-1",
        ),
      ),
    )
    .toBe(true);
  await page.getByLabel("Profile notes").fill("Updated profile note");
  await page.getByLabel("Notes save mode").selectOption("replace");
  await page.getByRole("button", { name: "Save notes" }).click();
  await expect(page.getByRole("status")).toContainText("version 2");
  await expect(page.getByText("Version 1", { exact: false })).toBeVisible();
  const replace = await page.evaluate(() =>
    window.__browserloginMockCalls?.find(
      (item) => item.method === "notesReplace",
    ),
  );
  expect(replace?.params).toMatchObject({
    expectedVersion: 1,
    notes: "Updated profile note",
  });
  await page.screenshot({
    path: join(evidence, "task-28-admin.png"),
    fullPage: true,
  });
});

test("notes conflict is explicit and non-owner actions are absent", async ({
  page,
}) => {
  await page.goto("/audit?notesConflict=1");
  await page.getByRole("button", { name: "Save notes" }).click();
  await expect(page.getByRole("status")).toContainText("Reload latest");
  await page.goto("/users?owner=0");
  await expect(page.getByRole("button", { name: "Disable user" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Share profile" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await page.goto("/proxies?owner=0");
  await expect(page.getByText("Local", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add proxy" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change IP" })).toHaveCount(0);
  await page.screenshot({
    path: join(evidence, "task-28-roles.png"),
    fullPage: true,
  });
});
