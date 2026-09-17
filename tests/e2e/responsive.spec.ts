import { expect, test } from "@playwright/test";

import { LOCAL_MCP_URL } from "../../src/shared/mcp-endpoints.js";

test("MCP guide contains mobile navigation and expanded tool tables", async ({
  page,
}) => {
  // Given
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/guides/mcp");
  await expect(
    page.getByRole("heading", { name: "MCP guide", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("46 safe-default tools after setup", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("p", {
      has: page.getByText("browserlogin mcp", { exact: true }),
    }),
  ).toContainText("stdio exposes the same merged registry");
  await expect(
    page
      .locator("[data-guide-section]")
      .evaluateAll((sections) =>
        sections.map((section) => section.getAttribute("data-guide-section")),
      ),
  ).resolves.toEqual([
    "local-endpoint",
    "client-setup",
    "developer-clients",
    "first-workflow",
    "tool-catalog",
    "public-endpoint",
  ]);

  // Then
  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.documentWidth).toBe(layout.viewportWidth);

  const primaryNavigation = page.locator(
    'aside[aria-label="Primary navigation"] nav',
  );
  const navigationLayout = await primaryNavigation.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      hasOverflowingChild: Array.from(element.children).some((child) => {
        const childBounds = child.getBoundingClientRect();
        return (
          childBounds.left < bounds.left || childBounds.right > bounds.right
        );
      }),
    };
  });
  expect(navigationLayout.scrollWidth).toBeLessThanOrEqual(
    navigationLayout.clientWidth,
  );
  expect(navigationLayout.hasOverflowingChild).toBe(false);

  // When
  const toolCatalogSummary = page
    .locator("summary")
    .filter({ hasText: "Available AI tools" });
  await expect(toolCatalogSummary.getByText("Show details")).toBeVisible();
  await toolCatalogSummary.click();
  await expect(toolCatalogSummary.getByText("Hide details")).toBeVisible();
  await page
    .locator("summary")
    .filter({ hasText: "Lifecycle and bootstrap (4)" })
    .click();

  // Then
  const expandedLayout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(expandedLayout.documentWidth).toBe(expandedLayout.viewportWidth);

  const tableScroller = page
    .locator(".overflow-x-auto")
    .filter({
      has: page.locator("table.data-table"),
    })
    .first();
  await expect(tableScroller).toBeVisible();
  expect(
    await tableScroller.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
});

test("MCP guide copies the local endpoint and prioritizes desktop setup", async ({
  context,
  page,
}) => {
  // Given
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/guides/mcp");
  await expect(
    page.locator('[data-client-id="chatgpt-desktop"]'),
  ).toBeVisible();
  await expect(page.locator("[data-platform-id]")).toHaveCount(3);
  const copyButton = page.getByRole("button", {
    name: "Copy local MCP endpoint",
  });

  // When
  await copyButton.click();

  // Then
  await expect(copyButton).toContainText("Copied");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(LOCAL_MCP_URL);
});

test("MCP tool table is an explicit keyboard scroll region", async ({
  page,
}) => {
  // Given
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/guides/mcp");
  await page
    .locator("summary")
    .filter({ hasText: "Available AI tools" })
    .click();
  const lifecycleSummary = page
    .locator("summary")
    .filter({ hasText: "Lifecycle and bootstrap (4)" });
  await lifecycleSummary.click();
  await expect(lifecycleSummary).toBeFocused();
  const tableScroller = page
    .locator(".overflow-x-auto")
    .filter({ has: page.locator("table.data-table") })
    .first();
  await expect(tableScroller).toHaveAttribute("tabindex", "0");
  await expect(tableScroller).toHaveAttribute("role", "region");
  await expect(tableScroller).toHaveAccessibleName("AI tool table");

  // When
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowRight");

  // Then
  await expect(tableScroller).toBeFocused();
  await expect
    .poll(() => tableScroller.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
});
