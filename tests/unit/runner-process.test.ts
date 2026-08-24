import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  runnerEntrypoint,
  safeRunnerDiagnostic,
} from "../../src/core/runner/process.js";

describe("runner process entrypoint", () => {
  test("allows only structured timing and SOCKS diagnostics", () => {
    // Given
    const safeTiming =
      "[launch-timing] stage=cdp-readiness delta_ms=125 total_ms=920";
    const credentialLookalike =
      "[launch-timing] stage=cdp-readiness delta_ms=125 total_ms=920 password=secret";

    // When
    const results = [
      safeRunnerDiagnostic(safeTiming),
      safeRunnerDiagnostic("[socks-relay] phase=upstream-connect"),
      safeRunnerDiagnostic(
        "[socks-relay] phase=client-greeting detail=timeout bytes=0",
      ),
      safeRunnerDiagnostic(credentialLookalike),
      safeRunnerDiagnostic("[launch-timing] stage=unknown delta_ms=1 total_ms=1"),
    ];

    // Then
    expect(results).toEqual([true, true, true, false, false]);
  });

  test("resolves the copied runner beside a packaged Cottontail main bundle", () => {
    // Given: Electrobun's packaged main-process module location.
    const mainModuleUrl = pathToFileURL(
      join(process.cwd(), "fixtures", "app", "bun", "index.js"),
    ).href;

    // When: the supervisor resolves the child entrypoint for that module.
    const entrypoint = runnerEntrypoint(mainModuleUrl);

    // Then: Cottontail receives the copied JavaScript runner, not source TypeScript.
    expect(entrypoint).toBe(
      fileURLToPath(
        new URL(
          "../runner/child.js",
          mainModuleUrl,
        ),
      ),
    );
  });
});
