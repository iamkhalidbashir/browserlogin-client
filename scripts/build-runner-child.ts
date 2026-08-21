import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const outputDirectory = join(process.cwd(), "dist", "runner");
await mkdir(outputDirectory, { recursive: true });

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
    "--outdir",
    outputDirectory,
  ],
  { cwd: process.cwd(), stdin: "ignore", stdout: "inherit", stderr: "inherit" },
);
if ((await child.exited) !== 0) throw new Error("runner child build failed");
