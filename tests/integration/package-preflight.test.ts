import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const scannerPath = join(repositoryRoot, "scripts", "check-package-preflight.ts");
const bun = process.versions.bun
  ? process.execPath
  : (process.env.BROWSERLOGIN_BUN_PATH ?? "bun");

type PreflightResult = {
  readonly code: number | null;
  readonly stderr: string;
};

async function runPreflight(
  paths: readonly string[],
): Promise<PreflightResult> {
  const root = await mkdtemp(join(tmpdir(), "browserlogin-package-preflight-"));
  try {
    const packageRoot = join(root, "build", "dev-fixture");
    await mkdir(packageRoot, { recursive: true });
    for (const path of paths) {
      const fixturePath = join(packageRoot, path);
      await mkdir(dirname(fixturePath), { recursive: true });
      await writeFile(fixturePath, "fixture");
    }

    const child = spawn(bun, [scannerPath], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    return await new Promise<PreflightResult>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve({ code, stderr }));
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("package preflight Playwright source policy", () => {
  test(
    "accepts only immediate Chromium JavaScript and resource files",
    async () => {
      // Given: required Playwright Chromium source and resource files.
      const paths = [
        "Resources/app/runner/node_modules/playwright-core/lib/server/chromium/chromium.js",
        "Resources/app/runner/node_modules/playwright-core/lib/server/chromium/appIcon.png",
      ] as const;

      // When: the real package preflight scanner checks the development package.
      const result = await runPreflight(paths);

      // Then: the precise runtime source allowance is accepted.
      expect(result.code, result.stderr).toBe(0);
    },
    10_000,
  );

  test.each([
    [
      "an executable-style name inside the allowed directory",
      "Resources/app/runner/node_modules/playwright-core/lib/server/chromium/chrome",
    ],
    [
      "a nested source file inside the allowed directory",
      "Resources/app/runner/node_modules/playwright-core/lib/server/chromium/nested/helper.js",
    ],
    [
      "the rest of the Playwright package",
      "Resources/app/runner/node_modules/playwright-core/bin/reinstall_chrome_beta_linux.sh",
    ],
    [
      "a browser payload elsewhere",
      "Resources/app/runner/chrome",
    ],
  ])("rejects %s", async (_case, path) => {
    // Given: a development package containing a path outside the source allowance.
    // When: the real package preflight scanner checks the development package.
    const result = await runPreflight([path]);

    // Then: the browser payload policy rejects the package.
    expect(result.code).not.toBe(0);
  }, 10_000);
});
