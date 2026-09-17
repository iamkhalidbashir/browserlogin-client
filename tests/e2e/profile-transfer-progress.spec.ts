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
  await expect(
    launchRow.getByText("Downloading 40%", { exact: true }),
  ).toBeVisible();
  await expect(
    stopRow.getByText("Uploading 65%", { exact: true }),
  ).toBeVisible();
  const downloadProgress = launchRow.getByRole("progressbar", {
    name: "Research profile download progress",
  });
  const uploadProgress = stopRow.getByRole("progressbar", {
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
  await page.goto(
    "/profiles?multi=1&profile2Running=1&profileActionDelayMs=700&transferProgress=failed-upload",
  );
  const row = page.getByRole("row", { name: /Secondary profile/ });

  // When
  await row.getByRole("button", { name: "Stop", exact: true }).click();

  // Then
  await expect(
    row.getByText("Upload failed at 65%", { exact: true }),
  ).toBeVisible();
  const progress = row.getByRole("progressbar", {
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
  await expect(row).not.toContainText("100%");
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
  await expect(row.getByRole("progressbar")).toHaveCount(0);
  await expect(row).not.toContainText("0%");
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
  await expect(row.getByText("Downloaded 100%", { exact: true })).toBeVisible();
  await expect(
    row.getByRole("progressbar", {
      name: "Research profile download progress",
    }),
  ).toHaveAttribute("value", "100");
  await expect(
    row.getByRole("button", { name: "Stop", exact: true }),
  ).toBeEnabled();
  await expect(row.getByText("Downloaded 100%", { exact: true })).toBeVisible();
});
