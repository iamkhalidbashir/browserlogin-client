import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApplicationMenu, BrowserWindow, Utils } from "electrobun/main";
import { readAutoCheckUpdates } from "../core/app/settings.js";
import { ConnectionStore } from "../core/config/connection.js";
import { resolveStateRoot, statePaths } from "../core/config/paths.js";
import { createKeychainBackend } from "../core/keychain/index.js";
import { withLock } from "../core/locks/locks.js";
import { lockPath } from "../core/locks/names.js";
import { startLocalMcpHttpServer } from "../mcp/http-server.js";
import { defineAppRPC, type AppServices } from "./rpc.js";
import { UpdateController, installLaunchUpdateCheck } from "./updater.js";
import { createCoreAppRuntime } from "./services.js";
import { installMainProcessShutdown } from "./shutdown.js";

export type MainProcessOptions = {
  readonly root?: string;
  readonly services?: AppServices;
  readonly recover?: () => Promise<unknown>;
  readonly createWindow?: (
    rpc: Awaited<ReturnType<typeof defineAppRPC>>,
  ) => unknown;
  readonly quit?: () => void | Promise<void>;
  readonly checkUpdates?: boolean;
  readonly startMcp?: typeof startLocalMcpHttpServer;
};

export type SingleInstance = { release: () => void; acquired: Promise<void> };

const APPLICATION_MENU = [
  {
    label: "BrowserLogin",
    submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
] satisfies Parameters<typeof ApplicationMenu.setApplicationMenu>[0];

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

async function writeReadiness(root: string, mcpUrl: string): Promise<void> {
  const markerDirectory = statePaths(root).ready;
  await mkdir(markerDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(markerDirectory, "main-process.json"),
    JSON.stringify({
      ready: true,
      pid: process.pid,
      mcp_url: mcpUrl,
      timestamp: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
}

export function dispatchEarlyArgs(argv = process.argv.slice(2)): boolean {
  return (
    argv.includes("--browserlogin-smoke") ||
    process.env.BROWSERLOGIN_SPIKE_SMOKE === "1"
  );
}

export async function startMainProcess(
  options: MainProcessOptions = {},
): Promise<{
  window: unknown;
  stop: () => Promise<void>;
}> {
  const root = options.root ?? resolveStateRoot();
  const instance = await holdSingleInstance(root);
  const startMcp = options.startMcp ?? startLocalMcpHttpServer;
  let localMcp:
    Awaited<ReturnType<typeof startLocalMcpHttpServer>> | undefined =
    await startMcp({
      stateRoot: root,
    }).catch((error: unknown) => {
      instance.release();
      throw error;
    });
  let core: ReturnType<typeof createCoreAppRuntime> | undefined;
  let stopUpdates: (() => void) | undefined;
  let released = false;
  let mcpOperation = Promise.resolve();
  const serializeMcp = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mcpOperation.then(operation);
    mcpOperation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const closeLocalMcp = async (): Promise<void> => {
    const current = localMcp;
    localMcp = undefined;
    const results = await Promise.allSettled([
      ...(current ? [current.close()] : []),
      rm(join(statePaths(root).ready, "main-process.json"), { force: true }),
    ]);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
  };
  const releaseOwnedResources = async (): Promise<void> => {
    if (released) return;
    released = true;
    const results = await Promise.allSettled([
      Promise.resolve().then(() => stopUpdates?.()),
      serializeMcp(closeLocalMcp),
      Promise.resolve().then(() => core?.application.close()),
    ]);
    instance.release();
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
  };
  try {
    const keychain = createKeychainBackend();
    const connection = new ConnectionStore(root, keychain);
    const updateController = new UpdateController();
    const checkUpdates =
      options.checkUpdates ?? (await readAutoCheckUpdates(root));
    const rpcBinding: {
      current?: Awaited<ReturnType<typeof defineAppRPC>>;
    } = {};
    core = createCoreAppRuntime({
      root,
      connection,
      keychain,
      updateController,
      emitProgress: (payload) =>
        rpcBinding.current?.emitBinaryProgress(payload),
    });
    const recovery = options.recover ?? core.recover;
    if (recovery)
      void Promise.race([
        recovery(),
        new Promise((resolve) => setTimeout(resolve, 30_000)),
      ]).catch(() => undefined);
    const configuredServices: AppServices = {
      ...core.services,
      ...(options.services ?? {}),
    };
    const restartLocalMcp = () =>
      serializeMcp(async () => {
        if (released) return;
        await closeLocalMcp();
        if (released) return;
        const next = await startMcp({ stateRoot: root });
        if (released) {
          await next.close();
          return;
        }
        localMcp = next;
        try {
          await writeReadiness(root, next.url);
        } catch (error) {
          localMcp = undefined;
          await next.close();
          throw error;
        }
      });
    const connectionSet = configuredServices.connectionSet;
    const connectionClear = configuredServices.connectionClear;
    const services: AppServices = {
      ...configuredServices,
      ...(connectionSet
        ? {
            connectionSet: async (params: unknown) => {
              const result = await connectionSet(params);
              await restartLocalMcp();
              return result;
            },
          }
        : {}),
      ...(connectionClear
        ? {
            connectionClear: async (params: unknown) => {
              const result = await connectionClear(params);
              await restartLocalMcp();
              return result;
            },
          }
        : {}),
    };
    const rpc = await defineAppRPC({ services });
    rpcBinding.current = rpc;
    stopUpdates = installLaunchUpdateCheck(
      (state) =>
        rpc.emitUpdateStatus({
          status: "available",
          message: `BrowserLogin ${state.version ?? "update"} is available`,
        }),
      updateController,
      checkUpdates,
    );
    ApplicationMenu.setApplicationMenu(APPLICATION_MENU);
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
    if (!localMcp) throw new Error("Local MCP server is unavailable");
    await writeReadiness(root, localMcp.url);
    return {
      window,
      stop: async () => {
        await releaseOwnedResources();
        await (options.quit ?? (() => Utils.quit()))();
      },
    };
  } catch (error) {
    await releaseOwnedResources().catch(() => undefined);
    throw error;
  }
}

export async function main(): Promise<void> {
  if (dispatchEarlyArgs()) return;
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
  const active = await startMainProcess({ quit: () => undefined });
  installMainProcessShutdown(active);
}

if (
  import.meta.main ||
  process.argv[1]?.endsWith("/Resources/main.js") ||
  process.argv[1]?.endsWith("\\Resources\\main.js")
)
  void main();
