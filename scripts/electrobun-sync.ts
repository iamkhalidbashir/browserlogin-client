import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const executable = process.platform === "win32" ? "hutch.exe" : "hutch";

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function resolveHutch(): Promise<string> {
  const configured = process.env.HUTCH_BIN;
  if (configured) {
    await access(configured);
    return configured;
  }

  const userInstall = join(homedir(), ".hutch", "bin", executable);
  try {
    await access(userInstall);
    return userInstall;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  return executable;
}

async function sync(): Promise<number> {
  const hutch = await resolveHutch();
  const child = spawn(hutch, ["electrobun", "sync"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

try {
  process.exitCode = await sync();
} catch (error) {
  const detail = error instanceof Error ? `: ${error.message}` : "";
  process.stderr.write(
    `Unable to synchronize the Electrobun devkit${detail}\nInstall Hutch, set HUTCH_BIN, or add it to PATH.\n`,
  );
  process.exitCode = 1;
}
