import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const routes = [
  ["Dashboard", "/dashboard"],
  ["Profiles", "/profiles"],
  ["Proxies", "/proxies"],
  ["Users", "/users"],
  ["Audit", "/audit"],
  ["Sessions", "/sessions"],
  ["Settings", "/settings"],
] as const;

test("renders all seven routes with mock data and clean console", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/dashboard");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  for (const [label, path] of routes) {
    await page.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
  }
  expect(errors).toEqual([]);
  const directory =
    process.env.BROWSERLOGIN_EVIDENCE_DIR ??
    join(process.cwd(), "test-results");
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, "task-26-shell.png"),
    fullPage: true,
  });
});

test("primary navigation and content are keyboard reachable", async ({
  page,
}) => {
  await page.goto("/dashboard");
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

test("system dark mode renders a dark application surface", async ({
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
  if (oklch) expect(Number(oklch[1])).toBeLessThan(0.3);
  else {
    const rgb = background.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    expect(rgb).not.toBeNull();
    expect(Number(rgb![1]) + Number(rgb![2]) + Number(rgb![3])).toBeLessThan(
      150,
    );
  }
  const directory =
    process.env.BROWSERLOGIN_EVIDENCE_DIR ??
    join(process.cwd(), "test-results");
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, "task-30-dark.png"),
    fullPage: true,
  });
});
