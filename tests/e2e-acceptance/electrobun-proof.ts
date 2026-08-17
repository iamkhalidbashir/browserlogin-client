import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  evidenceRoot,
  ensureEvidenceDirectory,
  runCommand,
  stopProcessTree,
  writeJson,
} from "./support.js";

const electrobunEvidence = join(evidenceRoot, "electrobun");
await ensureEvidenceDirectory(electrobunEvidence);
const generated: string[] = [];
for (const path of [
  join(process.cwd(), "build"),
  join(process.cwd(), ".cottontail-tmp"),
]) {
  try {
    await access(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      generated.push(path);
    else throw error;
  }
}
const build = await runCommand("bun", ["run", "build:web"], {
  timeoutMs: 120_000,
  logPath: join(electrobunEvidence, "build.log"),
});
if (build.code !== 0) throw new Error("acceptance renderer build failed");
const root = await mkdtemp(join(tmpdir(), "browserlogin-acceptance-app-"));
const appLog = join(electrobunEvidence, "app.log");
const child = spawn("bun", ["scripts/electrobun.ts", "dev"], {
  cwd: process.cwd(),
  detached: process.platform !== "win32",
  env: {
    ...process.env,
    BROWSERLOGIN_STATE_DIR: root,
    BROWSERLOGIN_MAIN_TEST_MODE: "1",
    BROWSERLOGIN_SPIKE_SMOKE: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout?.on("data", (chunk) => {
  output += String(chunk);
});
child.stderr?.on("data", (chunk) => {
  output += String(chunk);
});
try {
  const marker = join(root, "ready", "main-process.json");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await access(marker);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (child.exitCode !== null)
        throw new Error(`Electrobun exited before readiness: ${output}`, {
          cause: error,
        });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  }
  await access(marker);
  const ready = JSON.parse(await readFile(marker, "utf8")) as {
    ready?: boolean;
    pid?: number;
  };
  if (ready.ready !== true || typeof ready.pid !== "number")
    throw new Error("Electrobun readiness marker is invalid");
  await writeJson(join(electrobunEvidence, "readiness.json"), ready);
  await stopProcessTree(child);
  let alive = true;
  const stopDeadline = Date.now() + 5_000;
  while (Date.now() < stopDeadline) {
    try {
      process.kill(ready.pid, 0);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        alive = false;
        break;
      }
      throw error;
    }
  }
  if (alive)
    throw new Error("Electrobun process remained alive after teardown");
  await writeJson(join(electrobunEvidence, "proof.json"), {
    driver: "process/readiness",
    boot_ready: true,
    process_tree_stopped: true,
    playwright_controls_webview: false,
  });
} finally {
  await stopProcessTree(child);
  await writeFile(appLog, output);
  await rm(root, { recursive: true, force: true });
  await Promise.all(
    generated.map((path) => rm(path, { recursive: true, force: true })),
  );
}
