import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createOneShotLaunchFile } from "../../src/core/runner/launch.js";
import { writeAuthorization } from "../../src/core/runner/protocol.js";
import type { LaunchSpec } from "../../src/core/runner/types.js";

const packageManifestSchema = z.object({ version: z.string().min(1) });
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("runner child bundle", () => {
  test("is relocatable and reaches SDK executable validation", async () => {
    // Given: isolated bundle, protocol, profile, and cache locations.
    const bundleRoot = await mkdtemp(join(tmpdir(), "browserlogin-runner-bundle-"));
    const protocolRoot = await mkdtemp(
      join(tmpdir(), "browserlogin-runner-protocol-"),
    );
    const profileRoot = await mkdtemp(
      join(tmpdir(), "browserlogin-runner-profile-"),
    );
    const cacheRoot = await mkdtemp(
      join(tmpdir(), "browserlogin-runner-cache-"),
    );
    const preservedAssetPath = join(
      repositoryRoot,
      "dist",
      "runner",
      "appIcon-release-regression.png",
    );
    const diagnosticPath = join(protocolRoot, "runner-diagnostic.log");
    const diagnostic = await open(diagnosticPath, "wx", 0o600);
    try {
      const cloakBrowserRequire = createRequire(
        join(repositoryRoot, "node_modules", "cloakbrowser", "package.json"),
      );
      const sourcePlaywrightRoot = dirname(
        cloakBrowserRequire.resolve("playwright-core"),
      );
      const sourcePlaywrightManifestPath = join(
        sourcePlaywrightRoot,
        "package.json",
      );
      const bun = process.versions.bun
        ? process.execPath
        : (process.env.BROWSERLOGIN_BUN_PATH ?? "bun");
      await mkdir(dirname(preservedAssetPath), { recursive: true });
      await writeFile(preservedAssetPath, "electrobun-owned-asset");
      const build = spawn(bun, ["run", "build:runner-child"], {
        cwd: repositoryRoot,
        stdio: "inherit",
      });
      const buildCode = await new Promise<number | null>((resolve, reject) => {
        build.once("error", reject);
        build.once("exit", resolve);
      });
      expect(buildCode).toBe(0);
      await expect(readFile(preservedAssetPath, "utf8")).resolves.toBe(
        "electrobun-owned-asset",
      );

      const relocatedRunner = join(bundleRoot, "runner");
      await cp(join(repositoryRoot, "dist", "runner"), relocatedRunner, {
        recursive: true,
      });

      // When: the generated runner is inspected from outside the checkout.
      const childPath = join(relocatedRunner, "child.js");
      const childSource = await readFile(childPath, "utf8");
      const escapedSourceRoot = sourcePlaywrightRoot.replaceAll("\\", "\\\\");
      const copiedPlaywrightManifestPath = join(
        relocatedRunner,
        "node_modules",
        "playwright-core",
        "package.json",
      );
      const copiedPlaywrightBinPath = join(
        relocatedRunner,
        "node_modules",
        "playwright-core",
        "bin",
      );
      let copiedPlaywrightManifest: string | undefined;
      try {
        copiedPlaywrightManifest = await readFile(
          copiedPlaywrightManifestPath,
          "utf8",
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "ENOENT"
        )
          throw error;
      }

      // Then: the bundle contains no checkout path and carries its SDK dependency.
      const embedsSourceRoot = childSource.includes(escapedSourceRoot);
      expect.soft(embedsSourceRoot).toBe(false);
      expect.soft(copiedPlaywrightManifest).toBeDefined();
      await expect(access(copiedPlaywrightBinPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      if (embedsSourceRoot || copiedPlaywrightManifest === undefined) return;

      const sourceManifest = packageManifestSchema.parse(
        JSON.parse(await readFile(sourcePlaywrightManifestPath, "utf8")),
      );
      const copiedManifest = packageManifestSchema.parse(
        JSON.parse(copiedPlaywrightManifest),
      );
      expect(copiedManifest.version).toBe(sourceManifest.version);

      const paths = {
        launchFile: join(protocolRoot, "launch.json"),
        gateFile: join(protocolRoot, "authorized"),
        controlFile: join(protocolRoot, "control"),
        readyFile: join(protocolRoot, "ready"),
      };
      const spec = {
        profile_id: "relocated-runner-profile",
        seed: 7,
        platform:
          process.platform === "win32"
            ? "windows"
            : process.platform === "darwin"
              ? "macos"
              : "linux",
        geoip: false,
        humanize: false,
        human_preset: "default",
        bumblebee_profile: "default",
        headless: true,
        timezone: null,
        locale: null,
        user_agent: null,
        viewport: null,
        args: [],
        user_data_dir: profileRoot,
        browser_cache_dir: cacheRoot,
        browser_cache_max_bytes: 1024,
        proxy: null,
      } satisfies LaunchSpec;
      await createOneShotLaunchFile(paths.launchFile, spec);
      await writeAuthorization(paths.gateFile);

      const child = spawn(
        bun,
        [
          childPath,
          "--profile-id",
          spec.profile_id,
          "--launch-file",
          paths.launchFile,
          "--gate-file",
          paths.gateFile,
          "--control-file",
          paths.controlFile,
          "--ready-file",
          paths.readyFile,
        ],
        {
          cwd: bundleRoot,
          env: {
            ...process.env,
            BROWSERLOGIN_RUNNER_TEST_MODE: "1",
            BROWSERLOGIN_RUNNER_TEST_ERROR_FILE: diagnosticPath,
            CLOAKBROWSER_BINARY_PATH: join(bundleRoot, "missing-browser"),
          },
          stdio: ["ignore", "ignore", diagnostic.fd],
        },
      );
      const childCode = await new Promise<number | null>((resolve, reject) => {
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, 5_000);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("close", (code) => {
          clearTimeout(timer);
          if (timedOut) reject(new Error("relocated runner did not exit"));
          else resolve(code);
        });
      });
      await diagnostic.sync();
      const diagnostics = await readFile(diagnosticPath, "utf8");
      expect(childCode).toBe(1);
      expect(diagnostics).not.toContain("MODULE_NOT_FOUND");
      expect(diagnostics).toMatch(/executable.*(?:does not exist|doesn't exist)/i);
    } finally {
      await diagnostic.close();
      await Promise.all([
        rm(bundleRoot, { recursive: true, force: true }),
        rm(protocolRoot, { recursive: true, force: true }),
        rm(profileRoot, { recursive: true, force: true }),
        rm(cacheRoot, { recursive: true, force: true }),
        rm(preservedAssetPath, { force: true }),
      ]);
    }
  }, 120_000);
});
