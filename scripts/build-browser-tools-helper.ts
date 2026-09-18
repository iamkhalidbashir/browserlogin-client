import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  vendorHelperName,
  vendorScriptPath,
} from "../src/core/browser-tools/vendor-command.js";
import {
  makeBrowserToolsBundlePortable,
  readBrowserToolsBundleAssets,
} from "./browser-tools-portability.js";

const rootDirectory = process.cwd();
const outputDirectory = join(rootDirectory, "dist", "vendor");
await mkdir(outputDirectory, { recursive: true });
const helperOutput = join(outputDirectory, vendorHelperName());
const scriptOutput = join(outputDirectory, vendorScriptPath());
const scriptDirectory = dirname(scriptOutput);
const externalArguments = [
  "--external",
  "chromium-bidi/*",
  "--external",
  "electron",
] as const;

const runBuild = async (arguments_: readonly string[]): Promise<void> => {
  const child = Bun.spawn([process.execPath, "build", ...arguments_], {
    cwd: rootDirectory,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0)
    throw new Error("browser tools helper build failed");
};

await rm(scriptDirectory, { recursive: true, force: true });
await runBuild([
  "src/core/browser-tools/vendor-entry.cjs",
  ...externalArguments,
  "--target",
  "bun",
  "--outdir",
  scriptDirectory,
]);
const [bundle, assets] = await Promise.all([
  readFile(scriptOutput, "utf8"),
  readBrowserToolsBundleAssets(rootDirectory),
]);
await writeFile(
  scriptOutput,
  makeBrowserToolsBundlePortable(bundle, assets),
  "utf8",
);
await runBuild([
  scriptOutput,
  ...externalArguments,
  "--compile",
  "--outfile",
  helperOutput,
]);

process.stdout.write(`${helperOutput}\n${scriptOutput}\n`);
