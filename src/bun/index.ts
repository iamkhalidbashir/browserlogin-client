import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BrowserWindow, Utils } from "electrobun/main";
import { ConnectionStore } from "../core/config/connection.js";
import { resolveStateRoot, statePaths } from "../core/config/paths.js";
import { createKeychainBackend } from "../core/keychain/index.js";
import { withLock } from "../core/locks/locks.js";
import { lockPath } from "../core/locks/names.js";
import { defineAppRPC, type AppServices } from "./rpc.js";
import { UpdateController, installLaunchUpdateCheck } from "./updater.js";
import { createCoreAppRuntime } from "./services.js";

export type MainProcessOptions = {
  root?: string;
  services?: AppServices;
  recover?: () => Promise<unknown>;
  createWindow?: (rpc: Awaited<ReturnType<typeof defineAppRPC>>) => unknown;
  quit?: () => void | Promise<void>;
  checkUpdates?: boolean;
};

export type SingleInstance = { release: () => void; acquired: Promise<void> };

function enforceMinimumWindowSize(
  window: BrowserWindow,
  width: number,
  height: number,
): void {
  window.on("resize", () => {
    const frame = window.getFrame();
    const nextWidth = Math.max(width, frame.width);
    const nextHeight = Math.max(height, frame.height);
    if (nextWidth !== frame.width || nextHeight !== frame.height)
      window.setSize(nextWidth, nextHeight);
  });
}

export async function holdSingleInstance(
  root: string,
): Promise<SingleInstance> {
  let release!: () => void;
  let acquiredResolve!: () => void;
  let acquiredReject!: (error: unknown) => void;
  const acquired = new Promise<void>((resolve, reject) => {
    acquiredResolve = resolve;
    acquiredReject = reject;
  });
  await mkdir(join(root, "locks"), { recursive: true, mode: 0o700 });
  void withLock(lockPath(join(root, "locks"), "browserlogin-gui"), async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
      acquiredResolve();
    });
  }).catch(acquiredReject);
  await acquired;
  return { release: () => release?.(), acquired };
}

async function writeReadiness(root: string): Promise<void> {
  const markerDirectory = statePaths(root).ready;
  await mkdir(markerDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(markerDirectory, "main-process.json"),
    JSON.stringify({
      ready: true,
      pid: process.pid,
      timestamp: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
}

export async function dispatchEarlyArgs(
  argv = process.argv.slice(2),
): Promise<boolean> {
  if (
    argv.includes("--browserlogin-smoke") ||
    process.env.BROWSERLOGIN_SPIKE_SMOKE === "1"
  ) {
    return true;
  }
  if (argv.includes("mcp") || argv.includes("--mcp")) {
    const { main } = await import("../mcp/server.js");
    await main();
    return true;
  }
  if (argv.includes("--cli") || argv[0] === "browserlogin") {
    const cliModule = "../cli/index.js";
    const cli = await import(cliModule).catch(() => undefined);
    if (cli && "main" in cli && typeof cli.main === "function") {
      await cli.main();
      return true;
    }
    process.stderr.write("BrowserLogin CLI is not installed in this build\n");
    process.exitCode = 2;
    return true;
  }
  return false;
}

export async function startMainProcess(
  options: MainProcessOptions = {},
): Promise<{
  window: unknown;
  stop: () => Promise<void>;
}> {
  const root = options.root ?? resolveStateRoot();
  const instance = await holdSingleInstance(root);
  const keychain = createKeychainBackend();
  const connection = new ConnectionStore(root, keychain);
  const updateController = new UpdateController();
  const rpcBinding: {
    current?: Awaited<ReturnType<typeof defineAppRPC>>;
  } = {};
  const core = createCoreAppRuntime({
    root,
    connection,
    keychain,
    updateController,
    emitProgress: (payload) => rpcBinding.current?.emitBinaryProgress(payload),
  });
  const recovery = options.recover ?? core.recover;
  if (recovery)
    void Promise.race([
      recovery(),
      new Promise((resolve) => setTimeout(resolve, 30_000)),
    ]).catch(() => undefined);
  const services = {
    ...core.services,
    ...(options.services ?? {}),
  };
  const rpc = await defineAppRPC({
    services,
  });
  rpcBinding.current = rpc;
  let window: unknown;
  if (options.createWindow) {
    window = options.createWindow(rpc);
  } else {
    const browserWindow = new BrowserWindow({
      title: "BrowserLogin",
      url: "views://mainview/index.html",
      frame: { width: 1024, height: 700, x: 200, y: 120 },
      rpc,
    });
    enforceMinimumWindowSize(browserWindow, 1024, 700);
    window = browserWindow;
  }
  await writeReadiness(root);
  const stopUpdates =
    options.checkUpdates === false
      ? () => undefined
      : installLaunchUpdateCheck((state) =>
          rpc.emitUpdateStatus({
            status: state.updateAvailable ? "available" : "current",
            message: state.updateAvailable
              ? "Update available - download"
              : "BrowserLogin is current",
          }),
        );
  return {
    window,
    stop: async () => {
      stopUpdates();
      await core.application.close();
      instance.release();
      await rm(join(statePaths(root).ready, "main-process.json"), {
        force: true,
      });
      await (options.quit ?? (() => Utils.quit()))();
    },
  };
}

export async function main(): Promise<void> {
  if (await dispatchEarlyArgs()) return;
  if (process.env.BROWSERLOGIN_SPIKE_UPDATER === "1") {
    const state = await new UpdateController().downloadUpdate();
    process.stdout.write(
      `${JSON.stringify({ updateAvailable: state.updateAvailable, updateReady: state.updateReady })}\n`,
    );
    return;
  }
  if (process.env.BROWSERLOGIN_MAIN_TEST_MODE === "1") {
    const active = await startMainProcess({
      createWindow: () => ({ test: true }),
      recover: async () => undefined,
      quit: () => undefined,
      checkUpdates: false,
    });
    await new Promise<void>((resolve) => {
      process.once("SIGTERM", resolve);
      process.once("SIGINT", resolve);
    });
    await active.stop();
    return;
  }
  await startMainProcess();
}

if (
  import.meta.main ||
  process.argv[1]?.endsWith("/Resources/main.js") ||
  process.argv[1]?.endsWith("\\Resources\\main.js")
)
  void main();
