import { lstat, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const prohibitedPayload =
  /(^|[^a-z0-9])(chromium|chrome|cloakbrowser|chrome-headless-shell|chromium-headless-shell|chrome-sandbox|icudtl\.dat|resources\.pak|snapshot_blob\.bin|v8_context_snapshot\.bin|widevinecdm)([^a-z0-9]|$)/i;
const allowedLargeFile = /^(bun|bun\.exe|browserlogin-browser-tools-(macos-arm64|linux-x64|windows-x64)(\.exe)?)$/;

async function checkTree(root: string, directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const displayPath = relative(root, path);
    if (prohibitedPayload.test(displayPath))
      throw new Error(`prohibited browser payload path: ${displayPath}`);
    if (entry.isDirectory()) {
      await checkTree(root, path);
      continue;
    }
    if (!entry.isFile()) continue;
    const stats = await lstat(path);
    if (stats.size > MAX_FILE_BYTES && !allowedLargeFile.test(entry.name))
      throw new Error(`unexpected large package file: ${displayPath}`);
  }
}

const builds = (await readdir("build", { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("dev-"))
  .map((entry) => join("build", entry.name));

if (builds.length !== 1)
  throw new Error(`expected one development package, found ${builds.length}`);

await checkTree(builds[0]!, builds[0]!);
console.log(`package preflight passed: ${builds[0]}`);
