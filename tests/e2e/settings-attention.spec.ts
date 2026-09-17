import { expect, test } from "@playwright/test";

test("agent attention loads, constrains dependent controls, and saves only its preferences", async ({
  page,
}) => {
  // Given
  await page.goto("/settings");
  const panel = page.locator("article.panel", {
    has: page.getByRole("heading", { name: "Agent attention" }),
  });
  const enabled = panel.getByLabel("Enable agent attention");
  const delivery = panel.getByLabel("Delivery");
  const sound = panel.getByLabel("Sound");
  await expect(enabled).not.toBeChecked();
  await expect(delivery).toHaveValue("both");
  await expect(sound).toHaveValue("default");
  await expect(delivery).toBeDisabled();
  await expect(sound).toBeDisabled();

  // When
  await enabled.check();
  await delivery.selectOption("notification");

  // Then
  await expect(delivery).toBeEnabled();
  await expect(sound).toBeDisabled();

  // When
  await delivery.selectOption("both");
  await sound.selectOption("urgent");
  await enabled.focus();
  await page.keyboard.press("Tab");

  // Then
  await expect(delivery).toBeFocused();

  // When
  await panel
    .getByRole("button", { name: "Save attention preferences" })
    .click();

  // Then
  await expect(panel.getByRole("status")).toContainText(
    "Agent attention preferences saved.",
  );
  const settingsCalls = await page.evaluate(() =>
    window.__browserloginMockCalls?.filter(
      (item) => item.method === "settingsSet",
    ),
  );
  expect(settingsCalls?.at(-1)?.params).toEqual({
    attentionEnabled: true,
    attentionDelivery: "both",
    attentionSound: "urgent",
  });
});

test("agent attention select value fits at 375px while desktop keeps two columns", async ({
  page,
}) => {
  // Given
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/settings");
  const panel = page.locator("article.panel", {
    has: page.getByRole("heading", { name: "Agent attention" }),
  });
  const delivery = panel.getByLabel("Delivery");

  // When
  const selectedValueFits = await delivery.evaluate((element) => {
    if (!(element instanceof HTMLSelectElement)) return false;
    const selected = element.selectedOptions.item(0);
    const context = document.createElement("canvas").getContext("2d");
    if (!selected || !context) return false;
    const style = window.getComputedStyle(element);
    context.font = style.font;
    const contentWidth =
      context.measureText(selected.text).width +
      Number.parseFloat(style.paddingLeft) +
      Number.parseFloat(style.paddingRight) +
      32;
    return element.clientWidth >= Math.ceil(contentWidth);
  });

  // Then
  expect(selectedValueFits).toBe(true);

  // When
  await page.setViewportSize({ width: 1280, height: 800 });
  const desktopColumns = await page
    .locator(".settings-grid")
    .evaluate(
      (element) =>
        window.getComputedStyle(element).gridTemplateColumns.split(" ").length,
    );

  // Then
  expect(desktopColumns).toBe(2);
});
