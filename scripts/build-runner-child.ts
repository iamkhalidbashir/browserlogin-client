import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const outputDirectory = join(process.cwd(), "dist", "runner");
const cloakBrowserEntrypoint = import.meta.resolve("cloakbrowser");
const playwrightDirectory = dirname(
  createRequire(cloakBrowserEntrypoint).resolve("playwright-core/package.json"),
);
const copiedPlaywrightDirectory = join(
  outputDirectory,
  "node_modules",
  "playwright-core",
);

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  rm(join(outputDirectory, "child.js"), { force: true }),
  rm(copiedPlaywrightDirectory, { recursive: true, force: true }),
]);

const child = Bun.spawn(
  [
    process.execPath,
    "build",
    "src/core/runner/child.ts",
    "--target",
    "bun",
    "--external",
    "chromium-bidi/*",
    "--external",
    "electron",
    "--external",
    "playwright-core",
    "--external",
    "playwright-core/*",
    "--outdir",
    outputDirectory,
  ],
  { cwd: process.cwd(), stdin: "ignore", stdout: "inherit", stderr: "inherit" },
);
if ((await child.exited) !== 0) throw new Error("runner child build failed");
await cp(
  playwrightDirectory,
  copiedPlaywrightDirectory,
  { recursive: true },
);
await rm(join(copiedPlaywrightDirectory, "bin"), {
  recursive: true,
  force: true,
});
