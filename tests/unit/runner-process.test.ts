import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { runnerEntrypoint } from "../../src/core/runner/process.js";

describe("runner process entrypoint", () => {
  test("resolves the copied runner beside a packaged Cottontail main bundle", () => {
    // Given: Electrobun's packaged main-process module location.
    const mainModuleUrl =
      "file:///Applications/BrowserLogin.app/Contents/Resources/app/bun/index.js";

    // When: the supervisor resolves the child entrypoint for that module.
    const entrypoint = runnerEntrypoint(mainModuleUrl);

    // Then: Cottontail receives the copied JavaScript runner, not source TypeScript.
    expect(entrypoint).toBe(
      fileURLToPath(
        new URL(
          "../runner/child.js",
          "file:///Applications/BrowserLogin.app/Contents/Resources/app/bun/index.js",
        ),
      ),
    );
  });
});
