import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  evidenceRoot,
  ensureEvidenceDirectory,
  runCommand,
  writeJson,
} from "./support.js";

const scopeEvidence = join(evidenceRoot, "scope");
await ensureEvidenceDirectory(scopeEvidence);
const secretScan = await runCommand("bun", ["scripts/secrets-scan.ts"], {
  timeoutMs: 60_000,
  logPath: join(scopeEvidence, "secrets-scan.log"),
});
if (secretScan.code !== 0) throw new Error("tracked-file secret scan failed");

const setupPath = join(
  process.cwd(),
  "src/mainview/features/setup/setup-view.tsx",
);
const settingsPath = join(
  process.cwd(),
  "src/mainview/features/settings/settings-view.tsx",
);
const setup = await readFile(setupPath, "utf8");
const settings = await readFile(settingsPath, "utf8");
for (const [name, text] of [
  ["setup", setup],
  ["settings", settings],
] as const) {
  if (!text.includes('type="password"') || !text.includes("connectionSet"))
    throw new Error(`${name} API-key UI is not password/write-only context`);
}
if (!settings.includes('setApiKey("")'))
  throw new Error("settings API key is not cleared after save");

const prohibited =
  /^(chromium|chrome|chrome\.exe|cloakbrowser|cloakbrowser\.exe|cef)$/i;
const binaryFindings: string[] = [];
async function scanNames(root: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (prohibited.test(entry.name)) binaryFindings.push(path);
    if (entry.isDirectory()) await scanNames(path);
  }
}
for (const root of ["src", "scripts", "artifacts"])
  await scanNames(join(process.cwd(), root));
if (binaryFindings.length)
  throw new Error(`browser payload names found: ${binaryFindings.join(", ")}`);

await writeJson(join(scopeEvidence, "scope-drift.json"), {
  api_key_ui: {
    result: "PASS",
    bounded_files: [setupPath, settingsPath],
    allowed_context: "password input, connectionSet, clear-after-save",
  },
  embedded_private_seed: { result: "PASS", source: "scripts/secrets-scan.ts" },
  browser_payload_names: {
    result: "PASS",
    bounded_roots: ["src", "scripts", "artifacts"],
    findings: binaryFindings,
  },
});
