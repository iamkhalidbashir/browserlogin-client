import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  vendorHelperName,
  vendorScriptPath,
} from "../src/core/browser-tools/vendor-command.js";

const outputDirectory = join(process.cwd(), "dist", "vendor");
await mkdir(outputDirectory, { recursive: true });
const helperOutput = join(outputDirectory, vendorHelperName());
const scriptOutput = join(outputDirectory, vendorScriptPath());
const scriptDirectory = dirname(scriptOutput);
const commonArguments = [
  "build",
  "src/core/browser-tools/vendor-entry.cjs",
  "--external",
  "chromium-bidi/*",
  "--external",
  "electron",
] as const;

const runBuild = async (arguments_: readonly string[]): Promise<void> => {
  const child = Bun.spawn(
    [process.execPath, ...commonArguments, ...arguments_],
    {
      cwd: process.cwd(),
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await child.exited) !== 0)
    throw new Error("browser tools helper build failed");
};

await runBuild(["--compile", "--outfile", helperOutput]);
await rm(scriptDirectory, { recursive: true, force: true });
await runBuild(["--target", "bun", "--outdir", scriptDirectory]);

process.stdout.write(`${helperOutput}\n${scriptOutput}\n`);
