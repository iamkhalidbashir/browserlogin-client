import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const workflow = (
  await readFile(".github/workflows/release.yml", "utf8")
).replaceAll("\r\n", "\n");
const ciWorkflow = (
  await readFile(".github/workflows/ci.yml", "utf8")
).replaceAll("\r\n", "\n");
const packageManifest = await readFile("package.json", "utf8");
const hutchConfig = await readFile("hutch.config.ts", "utf8");
const electrobunWrapper = await readFile("scripts/electrobun.ts", "utf8");
const electrobunConfig = await readFile("electrobun.config.ts", "utf8");
const publishRelease = workflow.slice(
  workflow.indexOf("  publish-release:"),
  workflow.indexOf("  publish-updater:"),
);
const publishUpdater = workflow.slice(workflow.indexOf("  publish-updater:"));

function workflowStep(name: string): string {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  if (start < 0) throw new Error(`missing workflow step: ${name}`);
  const end = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, end < 0 ? undefined : end);
}

describe("release asset contract", () => {
  test("uses the stable Electrobun runtime for native RPC", () => {
    expect(packageManifest).toMatch(/"electrobun":\s*"2\.0\.1"/);
    expect(hutchConfig).toMatch(/version:\s*"2\.0\.1"/);
    expect(hutchConfig).not.toMatch(/^\/\/ @hutch .*cli=0\.10\.0/m);
  });

  test("uses the package-local Electrobun bootstrap for release builds", () => {
    expect(electrobunWrapper).toMatch(
      /node_modules.*electrobun.*bin.*electrobun\.cjs/s,
    );
  });

  test("does not configure missing Electrobun build hooks", () => {
    expect(electrobunConfig).not.toContain("postWrap");
  });

  test("prepares the generated Electrobun devkit before local development", () => {
    expect(packageManifest).toContain(
      '"electrobun:sync": "bun scripts/electrobun-sync.ts"',
    );
    expect(packageManifest).toContain(
      '"dev": "bun run electrobun:sync && bun run build:web',
    );
  });

  test("uses the pinned bootstrap in the production release workflow", () => {
    const applicationBuild = workflowStep(
      "Build signed and notarized Electrobun application",
    );
    expect(applicationBuild).toContain(
      "bun scripts/electrobun.ts build --env=stable",
    );
    expect(applicationBuild).not.toContain("hutch electrobun build");
  });

  test("builds Linux on the supported minimum runner", () => {
    expect(workflow).toContain(
      "target: linux-x64\n            runner: ubuntu-24.04",
    );
    expect(ciWorkflow).toContain("Verify Linux glibc baseline");
    expect(workflow).toContain("APPIMAGETOOL_X86_64_SHA256");
    expect(workflow).toContain("BUN_LINUX_X64_BASELINE_ZIP_SHA256");
    expect(workflow).toContain("Install Linux baseline Bun runtime");
    expect(workflow).toContain("ELECTROBUN_BASELINE_BUN_PATH");
    expect(workflow).toContain("--retry-all-errors");
    expect(workflow).toContain("bun run test:integration -- --retry 2");
    expect(workflow).toContain("Select Linux baseline Bun runtime");
    expect(workflow).toContain("*/linux-x64/bun");
  });

  test("stages versioned public downloads without updater artifacts", () => {
    expect(publishRelease).toContain('tagged_release="tagged-release"');
    expect(publishRelease).toContain(
      "BrowserLogin-${release_version}-macos-arm64.dmg",
    );
    expect(publishRelease).toContain(
      "BrowserLogin-${release_version}-windows-x64-Setup.zip",
    );
    expect(publishRelease).toContain(
      "BrowserLogin-${release_version}-linux-x64-Setup.tar.gz",
    );
    expect(publishRelease).toContain(
      "BrowserLogin-${release_version}-linux-x64.AppImage",
    );
    expect(publishRelease).toContain(
      "browserlogin-${release_version}-windows-x64.exe",
    );
    expect(publishRelease).toContain(
      "browserlogin-${release_version}-macos-arm64",
    );
    expect(publishRelease).toContain(
      "browserlogin-${release_version}-linux-x64",
    );
    expect(publishRelease).not.toContain(
      "production-macos-arm64-BrowserLogin.app.tar.zst",
    );
    expect(publishRelease).toContain("release_files=(tagged-release/*)");
    expect(publishRelease).toContain("--latest=false");
  });

  test("keeps the rolling stable channel on Electrobun filenames", () => {
    const stableAssets = [
      "production-macos-arm64-BrowserLogin.app.tar.zst",
      "production-macos-arm64-update.json",
      "production-win-x64-BrowserLogin.tar.zst",
      "production-win-x64-update.json",
      "production-linux-x64-BrowserLogin.tar.zst",
      "production-linux-x64-update.json",
    ];
    for (const asset of stableAssets) expect(publishUpdater).toContain(asset);
    expect(publishUpdater).toContain("production-*.patch");
    expect(publishUpdater).not.toContain("tagged-release");
    expect(workflow).toContain("!contains(github.ref_name, '+')");
    expect(publishUpdater).toContain("--pattern 'production-*'");
    expect(publishUpdater).toContain("unexpected stable asset");
    expect(publishUpdater).toContain("stable patch collision");
    expect(publishUpdater).toContain(
      "candidate patch missing from stable retry",
    );
    expect(publishUpdater).toContain("restored-verification");
    expect(publishUpdater).toContain(
      'gh release edit "$GITHUB_REF_NAME" -R "$GITHUB_REPOSITORY" --latest',
    );
    expect(
      workflowStep("Guard stable version and save rollback assets"),
    ).toContain("find . -maxdepth 1 -type f ! -name SHA256SUMS -print0");
    expect(
      publishUpdater.indexOf("Restore stable after publication failure"),
    ).toBeLessThan(publishUpdater.indexOf("Mark promoted release as latest"));
    expect(workflowStep("Verify published stable metadata")).toContain(
      "candidate_patches=(release/production-*.patch)",
    );
  });

  test("permits only the expected native helper above the expanded file cap", () => {
    expect(workflowStep("Validate and stage macOS/Linux artifacts")).toContain(
      "allowed_large.fullmatch(name)",
    );
    expect(workflowStep("Validate and stage Windows artifacts")).toContain(
      '$allowedLarge = @("browserlogin-browser-tools-windows-x64.exe", "bun.exe")',
    );
  });

  test("adds a guarded Windows installer entrypoint", () => {
    const windowsArtifacts = workflowStep("Validate and stage Windows artifacts");
    expect(workflow).toContain("Add guarded Windows installer entrypoint");
    expect(windowsArtifacts).toContain('$entrypoint = Join-Path $installerDir "Install-BrowserLogin.cmd"');
    expect(windowsArtifacts).toContain('Join-Path $installerDir ".installer\\BrowserLogin-Setup.tar.zst"');
  });
});
