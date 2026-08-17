import { access, readFile } from "node:fs/promises";
import { resolveStateRoot } from "../src/core/config/paths.js";

const timeoutMs = Number(process.env.BROWSERLOGIN_READY_TIMEOUT_MS ?? 60_000);
const root = resolveStateRoot();
const marker = `${root}/ready/main-process.json`;
const deadline = Date.now() + timeoutMs;

while (Date.now() < deadline) {
  try {
    await access(marker);
    const value = JSON.parse(await readFile(marker, "utf8")) as {
      ready?: boolean;
    };
    if (value.ready === true) {
      process.stdout.write(`${marker}\n`);
      process.exit(0);
    }
  } catch (error) {
    void error;
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

process.stderr.write(`Timed out waiting for ${marker}\n`);
process.exit(1);
