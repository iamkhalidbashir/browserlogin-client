import { expect, test, type Page } from "@playwright/test";

const updateCalls = async (page: Page) =>
  page.evaluate(() =>
    (window.__browserloginMockCalls ?? []).filter((call) =>
      call.method.startsWith("updates"),
    ),
  );

test("uses cached launch state and explicit update actions", async ({
  page,
}) => {
  await page.goto("/settings?update=available");
  const panel = page.locator("article.panel", {
    has: page.getByRole("heading", { name: "Application updates" }),
  });

  await expect(
    page.getByRole("heading", { name: "About BrowserLogin 0.1.32" }),
  ).toBeVisible();
  await expect(panel).toContainText("Version 0.2.0 available");
  await page.getByRole("button", { name: "Check now" }).click();
  await expect(panel).toContainText("Version 0.2.0 available");
  await page.getByRole("button", { name: "Download update" }).click();
  await expect(panel).toContainText("Ready to install");
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(panel).toContainText("Ready to install");
  await page.getByRole("button", { name: "Install and restart" }).click();
  await expect(panel).toContainText("Installing and restarting");

  await expect
    .poll(() => updateCalls(page))
    .toEqual([
      { method: "updatesCheck", params: { mode: "latest" } },
      { method: "updatesCheck", params: { mode: "refresh" } },
      { method: "updatesDownload", params: {} },
      { method: "updatesApply", params: { confirmed: true } },
    ]);
});

test("shows a cached update failure instead of Current", async ({ page }) => {
  await page.goto("/settings?update=check-error");
  const panel = page.locator("article.panel", {
    has: page.getByRole("heading", { name: "Application updates" }),
  });

  await expect(panel).toContainText("Update check failed");
  await expect(panel).not.toContainText("Current");
  await expect
    .poll(() => updateCalls(page))
    .toEqual([{ method: "updatesCheck", params: { mode: "latest" } }]);
});

test("renders update status and help text with normal-text contrast", async ({
  page,
}) => {
  // Given
  const scenarios = [
    { colorScheme: "light", route: "/settings?update=check-error" },
    { colorScheme: "dark", route: "/settings" },
  ] as const;
  const measurements: Array<{
    readonly colorScheme: "light" | "dark";
    readonly status: number;
    readonly help: number;
  }> = [];

  // When
  for (const scenario of scenarios) {
    await page.emulateMedia({ colorScheme: scenario.colorScheme });
    await page.goto(scenario.route);
    const panel = page.locator("article", {
      has: page.getByRole("heading", { name: "Application updates" }),
    });
    await expect(panel).toBeVisible();
    measurements.push(
      await panel.evaluate((panelElement, colorScheme) => {
        type Rgba = {
          readonly red: number;
          readonly green: number;
          readonly blue: number;
          readonly alpha: number;
        };

        const renderedColor = (cssColor: string): Rgba => {
          const canvas = document.createElement("canvas");
          canvas.width = 1;
          canvas.height = 1;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("Canvas 2D context is unavailable");
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = cssColor;
          context.fillRect(0, 0, 1, 1);
          const pixel = context.getImageData(0, 0, 1, 1).data;
          return {
            red: pixel[0] / 255,
            green: pixel[1] / 255,
            blue: pixel[2] / 255,
            alpha: pixel[3] / 255,
          };
        };
        const composite = (foreground: Rgba, background: Rgba): Rgba => {
          const alpha =
            foreground.alpha + background.alpha * (1 - foreground.alpha);
          if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
          return {
            red:
              (foreground.red * foreground.alpha +
                background.red * background.alpha * (1 - foreground.alpha)) /
              alpha,
            green:
              (foreground.green * foreground.alpha +
                background.green * background.alpha * (1 - foreground.alpha)) /
              alpha,
            blue:
              (foreground.blue * foreground.alpha +
                background.blue * background.alpha * (1 - foreground.alpha)) /
              alpha,
            alpha,
          };
        };
        const luminance = ({ red, green, blue }: Rgba): number => {
          const linear = (channel: number) =>
            channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4;
          return (
            0.2126 * linear(red) +
            0.7152 * linear(green) +
            0.0722 * linear(blue)
          );
        };
        const contrast = (foreground: Rgba, background: Rgba): number => {
          const foregroundLuminance = luminance(
            composite(foreground, background),
          );
          const backgroundLuminance = luminance(background);
          return (
            (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
            (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
          );
        };

        const statusElement = panelElement.querySelector("[aria-live]");
        const paragraphs = panelElement.querySelectorAll("p");
        if (!statusElement || paragraphs.length === 0)
          throw new Error("Update status or help text is unavailable");
        const helpElement = paragraphs.item(paragraphs.length - 1);
        const panelBackground = composite(
          renderedColor(getComputedStyle(panelElement).backgroundColor),
          renderedColor(getComputedStyle(document.body).backgroundColor),
        );

        return {
          colorScheme,
          status: contrast(
            renderedColor(getComputedStyle(statusElement).color),
            panelBackground,
          ),
          help: contrast(
            renderedColor(getComputedStyle(helpElement).color),
            panelBackground,
          ),
        };
      }, scenario.colorScheme),
    );
  }

  // Then
  for (const measurement of measurements) {
    expect
      .soft(
        measurement.status,
        `${measurement.colorScheme} update status contrast`,
      )
      .toBeGreaterThanOrEqual(4.5);
    expect
      .soft(measurement.help, `${measurement.colorScheme} update help contrast`)
      .toBeGreaterThanOrEqual(4.5);
  }
});

test("hydrates and immediately persists the automatic-check preference", async ({
  page,
}) => {
  await page.goto("/settings?autoCheck=0");
  const checkbox = page.getByLabel("Check automatically");

  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await expect
    .poll(async () => {
      const calls = await page.evaluate(
        () => window.__browserloginMockCalls ?? [],
      );
      return calls.filter((call) => call.method === "settingsSet").at(-1)
        ?.params;
    })
    .toEqual({ autoCheckUpdates: true });
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(checkbox).toBeChecked();

  await checkbox.uncheck();
  await expect
    .poll(async () => {
      const calls = await page.evaluate(
        () => window.__browserloginMockCalls ?? [],
      );
      return calls.filter((call) => call.method === "settingsSet").at(-1)
        ?.params;
    })
    .toEqual({ autoCheckUpdates: false });
});
