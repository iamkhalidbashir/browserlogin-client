import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const repositoryRoot = process.cwd();
export const evidenceRoot = resolve(
  process.env.BROWSERLOGIN_ACCEPTANCE_EVIDENCE_DIR ??
    join(
      repositoryRoot,
      "..",
      "cloakbrowser-pro",
      ".omo",
      "evidence",
      "acceptance",
    ),
);

export type CommandResult = {
  command: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

export async function ensureEvidenceDirectory(
  path = evidenceRoot,
): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function taskkill(pid: number): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", () => resolvePromise());
  });
}

export async function stopProcessTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (child.pid && process.platform === "win32") await taskkill(child.pid);
  else if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH")
        child.kill("SIGTERM");
    }
  } else child.kill("SIGTERM");

  const exited = await Promise.race([
    new Promise<true>((resolvePromise) =>
      child.once("exit", () => resolvePromise(true)),
    ),
    new Promise<false>((resolvePromise) =>
      setTimeout(() => resolvePromise(false), 5_000),
    ),
  ]);
  if (exited) return;
  if (child.pid && process.platform === "win32") await taskkill(child.pid);
  else if (child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH")
        child.kill("SIGKILL");
    }
  } else child.kill("SIGKILL");
}

export async function runCommand(
  command: string,
  args: readonly string[],
  options: {
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    logPath?: string;
  } = {},
): Promise<CommandResult> {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    detached: process.platform !== "win32",
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const result = await new Promise<CommandResult>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      void stopProcessTree(child).then(() =>
        reject(new Error(`command timed out: ${command} ${args.join(" ")}`)),
      );
    }, options.timeoutMs ?? 120_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({
        command: [command, ...args].join(" "),
        code,
        signal,
        stdout,
        stderr,
      });
    });
  });
  if (options.logPath) {
    await mkdir(dirname(options.logPath), { recursive: true });
    await writeFile(
      options.logPath,
      `$ ${result.command}\n${result.stdout}${result.stderr}\nexit=${String(result.code)} signal=${String(result.signal)}\n`,
    );
  }
  return result;
}

export async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
