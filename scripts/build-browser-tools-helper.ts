import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { vendorHelperName } from "../src/core/browser-tools/vendor.js";

const outputDirectory = join(process.cwd(), "dist", "vendor");
await mkdir(outputDirectory, { recursive: true });
const output = join(outputDirectory, vendorHelperName());
const child = Bun.spawn(
  [
    process.execPath,
    "build",
    "--compile",
    "src/core/browser-tools/vendor-entry.cjs",
    "--external",
    "chromium-bidi/*",
    "--external",
    "electron",
    "--outfile",
    output,
  ],
  { cwd: process.cwd(), stdin: "ignore", stdout: "inherit", stderr: "inherit" },
);
const code = await child.exited;
if (code !== 0) throw new Error("browser tools helper compile failed");
process.stdout.write(`${output}\n`);
