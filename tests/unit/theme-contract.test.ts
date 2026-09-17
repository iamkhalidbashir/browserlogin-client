import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("mainview theme contract", () => {
  test("uses light colors independently of the system preference", async () => {
    const css = await readFile("src/mainview/styles.css", "utf8");
    const themedViews = await Promise.all(
      [
        "src/mainview/app.tsx",
        "src/mainview/features/setup/setup-view.tsx",
        "src/mainview/features/settings/application-updates.tsx",
      ].map((path) => readFile(path, "utf8")),
    );

    expect(css).toMatch(/:root\s*{[^}]*color-scheme:\s*light/s);
    expect(css).not.toContain("@media (prefers-color-scheme: light)");
    expect(css).not.toContain(".dark");
    expect(themedViews.join("\n")).not.toContain("dark:");
  });
});
