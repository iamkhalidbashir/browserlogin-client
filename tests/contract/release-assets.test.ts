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
const playwrightChromiumSourceAllowance =
  String.raw`(^|/)app/runner/node_modules/playwright-core/lib/server/chromium(?:$|/[^/]+\.(?:js|png)$)`;
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

  test("validates generated macOS and Linux artifacts without stale names", () => {
    const nativeArtifacts = workflowStep("Validate and stage macOS/Linux artifacts");
    expect(nativeArtifacts).toContain('find artifacts -maxdepth 1 -type f -name "*BrowserLogin.dmg" -print -quit');
    expect(nativeArtifacts).toContain('find artifacts -maxdepth 1 -type f -name "*BrowserLogin-Setup.tar.gz" -print -quit');
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

  test("builds the runner child before Electrobun packages the application", () => {
    // Given: the production application packaging step.
    const applicationBuild = workflowStep(
      "Build signed and notarized Electrobun application",
    );

    // When: its commands are evaluated in execution order.
    // Then: the runner bundle is built before Electrobun consumes application assets.
    expect(applicationBuild).toMatch(
      /bun run build:runner-child[\s\S]*bun scripts\/electrobun\.ts build --env=stable/,
    );
  });

  test("builds Linux on the supported minimum runner", () => {
    expect(workflow).toContain(
      "target: linux-x64\n            runner: ubuntu-24.04",
    );
    expect(ciWorkflow).toContain("Verify Linux glibc baseline");
    expect(workflow).toContain("APPIMAGETOOL_X86_64_SHA256");
    expect(workflow).toContain("hutch electrobun sync");
    expect(workflow).toContain("bun run test:integration -- --retry 2");
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
      "stable-macos-arm64-BrowserLogin.app.tar.zst",
      "stable-macos-arm64-update.json",
      "stable-win-x64-BrowserLogin.tar.zst",
      "stable-win-x64-update.json",
      "stable-linux-x64-BrowserLogin.tar.zst",
      "stable-linux-x64-update.json",
    ];
    for (const asset of stableAssets) expect(publishUpdater).toContain(asset);
    expect(publishUpdater).toContain("production-*.patch");
    expect(publishUpdater).not.toContain("tagged-release");
    expect(workflow).toContain("!contains(github.ref_name, '+')");
    expect(
      workflowStep("Guard stable version and save rollback assets"),
    ).not.toContain("--pattern 'production-*'");
    expect(publishUpdater).toContain("unexpected stable asset");
    expect(publishUpdater).toContain("stable patch collision");
    expect(publishUpdater).toContain(
      "candidate patch missing from stable retry",
    );
    expect(
      workflowStep("Guard stable version and save rollback assets"),
    ).toContain("legacy_core_assets=(");
    expect(
      workflowStep("Guard stable version and save rollback assets"),
    ).toContain('cp "$rollback_dir/$legacy" "$rollback_dir/$stable"');
    expect(
      workflowStep("Guard stable version and save rollback assets"),
    ).toContain('rm -f "$rollback_dir/$legacy"');
    expect(workflowStep("Publish full bundles before metadata")).toContain(
      'for file in "${metadata[@]}" "${bundles[@]}" "${legacy_core_assets[@]}"',
    );
    expect(publishUpdater).toContain("restored-verification");
    expect(
      workflowStep("Restore stable after publication failure"),
    ).not.toContain("--pattern 'production-*'");
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

  test("uses the same precise Playwright Chromium source allowance on every release platform", () => {
    // Given: the macOS/Linux and Windows expanded-release validators.
    const nativeArtifacts = workflowStep(
      "Validate and stage macOS/Linux artifacts",
    );
    const windowsArtifacts = workflowStep("Validate and stage Windows artifacts");

    // When: their Playwright exceptions are inspected.
    // Then: both encode the exact immediate JavaScript/resource-file allowance.
    expect(nativeArtifacts).toContain(
      `r"${playwrightChromiumSourceAllowance}"`,
    );
    expect(nativeArtifacts).toContain(
      "prohibited.search(relative) and not allowed_playwright.search(relative)",
    );
    expect(windowsArtifacts).toContain(
      `$allowedPlaywright = '${playwrightChromiumSourceAllowance}'`,
    );
    expect(windowsArtifacts).toContain(
      "$archivePath -match $prohibited -and $archivePath -notmatch $allowedPlaywright",
    );
  });

  test("adds a guarded Windows installer entrypoint", () => {
    const windowsArtifacts = workflowStep("Validate and stage Windows artifacts");
    expect(workflow).toContain("Add guarded Windows installer entrypoint");
    expect(windowsArtifacts).toContain('$entrypoint = Join-Path $installerDir "Install-BrowserLogin.cmd"');
    expect(windowsArtifacts).toContain('Join-Path $installerDir ".installer\\BrowserLogin-Setup.tar.zst"');
  });
});
