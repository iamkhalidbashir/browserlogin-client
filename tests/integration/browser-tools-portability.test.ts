import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  makeBrowserToolsBundlePortable,
  readBrowserToolsBundleAssets,
} from "../../scripts/browser-tools-portability.js";
import { createF2VendorRuntime } from "../../src/core/browser-tools/vendor.js";

const roots: string[] = [];
const execute = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("browser tools helper portability", () => {
  it("starts after relocation when the build checkout no longer exists", async () => {
    // Given: a real browser-tools bundle whose build root is unavailable.
    const root = await mkdtemp(join(tmpdir(), "browserlogin-helper-portable-"));
    roots.push(root);
    const rawDirectory = join(root, "raw");
    await execute(
      process.env.BROWSERLOGIN_BUN_PATH ?? "bun",
      [
        "build",
        "src/core/browser-tools/vendor-entry.cjs",
        "--target",
        "bun",
        "--outdir",
        rawDirectory,
        "--external",
        "chromium-bidi/*",
        "--external",
        "electron",
      ],
      { cwd: process.cwd() },
    );
    const rawPath = join(rawDirectory, "vendor-entry.js");
    const raw = await readFile(rawPath, "utf8");
    const missingRoot = join(root, "missing-build-checkout");
    const poisoned = raw.replaceAll(process.cwd(), missingRoot);
    const relocated = join(root, "relocated", "vendor-entry.js");
    const assets = await readBrowserToolsBundleAssets(process.cwd());
    const portable = makeBrowserToolsBundlePortable(poisoned, assets);

    // When: the release portability transform prepares the relocated helper.
    await mkdir(join(root, "relocated"));
    await writeFile(relocated, portable);
    const runtime = await createF2VendorRuntime({
      profileId: "portability-test",
      relayCdpUrl: "ws://127.0.0.1:9/unused",
      nodeCommand: process.env.BROWSERLOGIN_BUN_PATH ?? "bun",
      cliPath: relocated,
    });

    try {
      // Then: startup and tool discovery do not read from the build checkout.
      expect(portable).not.toContain(missingRoot);
      await expect(runtime.listTools()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "browser_tabs" }),
        ]),
      );
    } finally {
      await runtime.close();
    }
  }, 60_000);
});
