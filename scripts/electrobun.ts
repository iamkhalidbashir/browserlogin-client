import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const command = process.argv[2] ?? "dev";
const executable = process.platform === "win32" ? "hutch.exe" : "hutch";
const candidates = [
  process.env.HUTCH_BIN,
  join(homedir(), ".hutch", "bin", executable),
  executable,
].filter((value): value is string => Boolean(value));

let hutch = candidates.at(-1)!;
for (const candidate of candidates.slice(0, -1)) {
  try {
    await access(candidate);
    hutch = candidate;
    break;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

const child = spawn(hutch, ["electrobun", command], {
  cwd: process.cwd(),
  env: process.env,
  detached: process.platform !== "win32",
  stdio: "inherit",
});
const completion = new Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
}>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => resolve({ code, signal }));
});

function sendPosixTreeSignal(
  processChild: ChildProcess,
  signal: NodeJS.Signals,
): void {
  if (!processChild.pid) return;
  try {
    process.kill(-processChild.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function stopWindowsTree(pid: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
    killer.once("error", reject);
    killer.once("exit", () => resolve());
  });
}

let stopping = false;
async function stop(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (child.pid && process.platform === "win32")
    await stopWindowsTree(child.pid);
  else sendPosixTreeSignal(child, signal);
  const exited = await Promise.race([
    completion.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!exited) {
    if (child.pid && process.platform === "win32")
      await stopWindowsTree(child.pid);
    else sendPosixTreeSignal(child, "SIGKILL");
    await completion;
  }
}

process.once("SIGTERM", () => void stop("SIGTERM"));
process.once("SIGINT", () => void stop("SIGINT"));

try {
  const result = await completion;
  process.exitCode = stopping ? 0 : (result.code ?? 1);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Electrobun command failed"}\n`,
  );
  process.exitCode = 1;
}
