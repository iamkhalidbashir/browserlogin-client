import { expect, test } from "@playwright/test";

test("profile fields support standard copy and paste shortcuts", async ({
  context,
  page,
}) => {
  // Given
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/profiles");
  await page.getByRole("button", { name: "Create profile" }).click();
  const dialog = page.getByRole("dialog", { name: "Create profile" });
  const name = dialog.getByLabel("Name");
  const timezone = dialog.getByLabel("Timezone");
  await name.fill("Clipboard profile");

  // When
  await name.press("ControlOrMeta+A");
  await name.press("ControlOrMeta+C");
  await timezone.press("ControlOrMeta+A");
  await timezone.press("ControlOrMeta+V");

  // Then
  await expect(timezone).toHaveValue("Clipboard profile");
});
