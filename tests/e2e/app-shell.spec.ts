import { expect, test } from "@playwright/test";

test("desktop sidebar stays fixed while application content scrolls", async ({
  page,
}) => {
  // Given
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto("/profiles?multi=1");
  await expect(
    page.getByRole("button", { name: "Create profile" }),
  ).toBeVisible();
  const sidebar = page.getByLabel("Primary navigation");
  const content = page.locator(".app-sidebar + div");
  const sidebarTop = await sidebar.evaluate(
    (element) => element.getBoundingClientRect().top,
  );

  // When
  await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  // Then
  expect(await content.evaluate((element) => element.scrollTop)).toBeGreaterThan(
    0,
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(
    await sidebar.evaluate((element) => element.getBoundingClientRect().top),
  ).toBe(sidebarTop);
});
