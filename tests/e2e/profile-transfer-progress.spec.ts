import { expect, test, type Page } from "@playwright/test";

function observePageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("shows independent download and upload percentages from one polled snapshot", async ({
  page,
}) => {
  // Given
  const pageErrors = observePageErrors(page);
  await page.goto(
    "/profiles?multi=1&profile2Running=1&profileActionDelayMs=1400&transferProgress=happy",
  );
  const launchRow = page.getByRole("row", { name: /Research profile/ });
  const stopRow = page.getByRole("row", { name: /Secondary profile/ });

  // When
  await launchRow.getByRole("button", { name: "Launch" }).click();
  await stopRow.getByRole("button", { name: "Stop", exact: true }).click();

  // Then
  const activity = page.getByRole("complementary", {
    name: "Profile activity",
  });
  await expect(
    activity.getByText("Downloading 40%", { exact: true }),
  ).toBeVisible();
  await expect(
    activity.getByText("Uploading 65%", { exact: true }),
  ).toBeVisible();
  const downloadProgress = activity.getByRole("progressbar", {
    name: "Research profile download progress",
  });
  const uploadProgress = activity.getByRole("progressbar", {
    name: "Secondary profile upload progress",
  });
  await expect(downloadProgress).toHaveAttribute("value", "40");
  await expect(downloadProgress).toHaveAttribute(
    "aria-valuetext",
    "40% downloaded",
  );
  await expect(uploadProgress).toHaveAttribute("value", "65");
  await expect(uploadProgress).toHaveAttribute(
    "aria-valuetext",
    "65% uploaded",
  );
  await expect(launchRow.getByRole("progressbar")).toHaveCount(0);
  await expect(stopRow.getByRole("progressbar")).toHaveCount(0);
  const callsWhilePending = await page.evaluate(
    () =>
      (window.__browserloginMockCalls ?? []).filter(
        (call) => call.method === "sessionsTransferProgress",
      ).length,
  );
  expect(callsWhilePending).toBeGreaterThanOrEqual(2);
  await expect(
    launchRow.getByRole("button", { name: "Stop", exact: true }),
  ).toBeEnabled();
  await expect(stopRow.getByRole("button", { name: "Launch" })).toBeEnabled();
  const callsAfterSettlement = await page.evaluate(
    () =>
      (window.__browserloginMockCalls ?? []).filter(
        (call) => call.method === "sessionsTransferProgress",
      ).length,
  );
  await page.waitForTimeout(600);
  const callsAfterIdle = await page.evaluate(
    () =>
      (window.__browserloginMockCalls ?? []).filter(
        (call) => call.method === "sessionsTransferProgress",
      ).length,
  );
  expect(callsAfterIdle).toBe(callsAfterSettlement);
  expect(pageErrors).toEqual([]);
});

test("keeps failed upload percentage distinct and restores profile actions", async ({
  page,
}) => {
  // Given
  const pageErrors = observePageErrors(page);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(
    "/profiles?multi=1&profile2Running=1&profileActionDelayMs=700&transferProgress=failed-upload",
  );
  const row = page.getByRole("row", { name: /Secondary profile/ });

  // When
  await row.getByRole("button", { name: "Stop", exact: true }).click();

  // Then
  const activity = page.getByRole("complementary", {
    name: "Profile activity",
  });
  await expect(
    activity.getByText("Upload failed at 65%", { exact: true }),
  ).toBeVisible();
  const progress = activity.getByRole("progressbar", {
    name: "Secondary profile upload progress",
  });
  await expect(progress).toHaveAttribute("value", "65");
  await expect(progress).toHaveAttribute(
    "aria-valuetext",
    "Upload failed at 65%",
  );
  await expect(
    row.getByRole("button", { name: "Stop", exact: true }),
  ).toBeEnabled();
  await expect(activity).toContainText(
    "Stop failed (SESSION_STOP_FAILED): Profile upload failed at the mock transfer boundary.",
  );
  await expect(activity).not.toContainText("100%");
  expect(
    consoleErrors.some((message) =>
      message.includes("Profile lifecycle action failed"),
    ),
  ).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("keeps launch fallback for a cache-hit snapshot without inventing zero percent", async ({
  page,
}) => {
  // Given
  await page.goto(
    "/profiles?profileActionDelayMs=700&transferProgress=cache-hit",
  );
  const row = page.getByRole("row", { name: /Research profile/ });

  // When
  await row.getByRole("button", { name: "Launch" }).click();

  // Then
  await expect(row.getByRole("button", { name: "Launching…" })).toBeDisabled();
  await expect(
    page.getByRole("complementary", { name: "Profile activity" }),
  ).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("0%");
});

test("keeps a delivered verified completion visible after launch settles", async ({
  page,
}) => {
  // Given
  await page.goto(
    "/profiles?profileActionDelayMs=700&transferProgress=completed",
  );
  const row = page.getByRole("row", { name: /Research profile/ });

  // When
  await row.getByRole("button", { name: "Launch" }).click();

  // Then
  const activity = page.getByRole("complementary", {
    name: "Profile activity",
  });
  await expect(
    activity.getByText("Downloaded 100%", { exact: true }),
  ).toBeVisible();
  await expect(
    activity.getByRole("progressbar", {
      name: "Research profile download progress",
    }),
  ).toHaveAttribute("value", "100");
  await expect(
    row.getByRole("button", { name: "Stop", exact: true }),
  ).toBeEnabled();
  await expect(
    activity.getByText("Downloaded 100%", { exact: true }),
  ).toBeVisible();
});
