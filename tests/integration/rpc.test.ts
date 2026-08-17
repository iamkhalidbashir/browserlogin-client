import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

const BUN = `${process.env.HOME ?? "/Users/bashir"}/.bun/bin/bun`;
const roots: string[] = [];
const children: ChildProcess[] = [];
const generated: string[] = [];

async function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      reject(new Error("Task 25 dev process did not exit"));
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once("exit", onExit);
  });
}

async function stopTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (child.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  } else {
    child.kill("SIGTERM");
  }
  await waitForExit(child, 5_000).catch(async () => {
    if (child.pid && process.platform !== "win32") {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    } else {
      child.kill("SIGKILL");
    }
    await waitForExit(child, 2_000).catch(() => undefined);
  });
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(stopTree));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  await Promise.all(
    generated
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Task 25 Electrobun main process", { timeout: 45_000 }, () => {
  test("boots the actual dev app, writes readiness, and tears down its process tree", async () => {
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
    const root = await mkdtemp(join(tmpdir(), "browserlogin-task25-"));
    roots.push(root);
    const child = spawn(BUN, ["run", "dev"], {
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
    children.push(child);
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-32_768);
    });
    const marker = join(root, "ready", "main-process.json");
    const deadline = Date.now() + 30_000;
    let markerFound = false;
    while (Date.now() < deadline) {
      try {
        await access(marker);
        markerFound = true;
        break;
      } catch {
        if (child.exitCode !== null)
          throw new Error(`Task 25 dev app exited early: ${stderr}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!markerFound)
      throw new Error(`Task 25 readiness marker was not written: ${stderr}`);
    const ready = JSON.parse(await readFile(marker, "utf8")) as {
      ready?: boolean;
      pid?: number;
    };
    expect(ready.ready).toBe(true);
    expect(ready.pid).toBeTypeOf("number");
    await stopTree(child);
    const cleanupDeadline = Date.now() + 5_000;
    let appAlive = true;
    while (Date.now() < cleanupDeadline) {
      try {
        process.kill(ready.pid!, 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          appAlive = false;
          break;
        }
        throw error;
      }
    }
    expect(appAlive).toBe(false);
  });
});
