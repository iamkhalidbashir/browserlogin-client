import { readFile } from "node:fs/promises";

const tracked = Bun.spawnSync(["git", "ls-files", "-z"], {
  stdout: "pipe",
  stderr: "pipe",
});
if (tracked.exitCode !== 0)
  throw new Error(new TextDecoder().decode(tracked.stderr));

const files = new TextDecoder()
  .decode(tracked.stdout)
  .split("\0")
  .filter(Boolean);
const failures: string[] = [];
const allowedText = /^(?:docs\/|tests\/|README\.md$|LICENSE$)/;
const privateSeedPattern =
  /(?:ed25519|private[_-]?seed|lease[_-]?seed).{0,40}[0-9a-f]{64}/i;
const productionApiKey = /\bbl_[A-Za-z0-9_-]{20,}\b/;
const stockLeaseKey = /619750ac[0-9a-f]{48}a4f6b5/i;

for (const file of files) {
  if (/sac_mouse_v2\.zip$/i.test(file)) {
    failures.push(`${file}: SAC source ZIP must not be committed`);
    continue;
  }
  if (allowedText.test(file)) continue;
  const bytes = await readFile(file).catch(() => undefined);
  if (!bytes || bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  if (privateSeedPattern.test(text))
    failures.push(`${file}: possible private seed material`);
  if (productionApiKey.test(text))
    failures.push(`${file}: production-style BrowserLogin API key`);
  if (stockLeaseKey.test(text))
    failures.push(`${file}: stock lease public key outside allowed docs/tests`);
}

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`secrets-scan passed (${files.length} tracked files)\n`);
}
