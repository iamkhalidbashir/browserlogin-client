import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { createApplicationRuntime } from "../core/app/index.js";
import { unwrapApplicationResult } from "../core/app/index.js";
import type { ApplicationRuntime } from "../core/app/runtime.js";
import { createBrowserTools } from "../core/browser-tools/factory.js";
import { visibleTools } from "../core/browser-tools/manifest.js";
import {
  ConnectionStore,
  SetupRequiredError,
} from "../core/config/connection.js";
import { resolveStateRoot } from "../core/config/paths.js";
import { createKeychainBackend } from "../core/keychain/index.js";
import { RemoteMcpDiscoveryCache } from "../core/mcp-proxy/cache.js";
import { RemoteMcpClient } from "../core/mcp-proxy/client.js";
import { RemoteMcpForwarder } from "../core/mcp-proxy/forward.js";
import {
  createRegistry,
  localToolNames,
  type LifecycleOperations,
  type RegistryDependencies,
  type UnifiedRegistry,
} from "./registry.js";

const LOG_LIMIT = 256 * 1024;

export type ServerRuntime = RegistryDependencies & {
  readonly registry?: UnifiedRegistry;
  readonly close?: () => Promise<void>;
};

export type McpRuntimeOptions = {
  readonly runtime?: ServerRuntime;
  readonly stateRoot?: string;
  readonly log?: boolean;
  readonly includeRemoteTools?: boolean;
  readonly remoteConnection?: "required" | "optional";
};

export type McpRuntime = {
  readonly registry: UnifiedRegistry;
  close(): Promise<void>;
};

async function rotateLog(path: string): Promise<void> {
  const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!info || info.size <= LOG_LIMIT) return;
  await rename(path, `${path}.1`).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function diagnosticLogger(root: string): Promise<() => Promise<void>> {
  const logs = join(root, "logs");
  await mkdir(logs, { recursive: true, mode: 0o700 });
  const path = join(logs, "mcp.log");
  await rotateLog(path);
  return async () => {
    await appendFile(path, `${new Date().toISOString()} MCP server stopped\n`, {
      mode: 0o600,
    });
  };
}

async function createRemoteDependencies(
  application: ApplicationRuntime,
): Promise<Pick<RegistryDependencies, "remoteCache" | "remoteForwarder">> {
  const resolution = await application
    .remoteConnection()
    .catch((error: unknown) => {
      if (error instanceof SetupRequiredError) throw error;
      throw new SetupRequiredError();
    });
  const remoteClient = new RemoteMcpClient({
    url: resolution.remoteMcpUrl,
    credentials: resolution.credentials,
  });
  return {
    remoteCache: new RemoteMcpDiscoveryCache(remoteClient),
    remoteForwarder: new RemoteMcpForwarder(remoteClient, localToolNames()),
  };
}

async function defaultRuntime(
  root: string,
  includeRemoteTools: boolean,
  remoteConnection: "required" | "optional",
): Promise<ServerRuntime> {
  const keychain = createKeychainBackend();
  const store = new ConnectionStore(root, keychain);
  const application = createApplicationRuntime({
    root,
    connection: store,
    keychain,
  });
  const browser = createBrowserTools({
    lookup: async (profileId) => {
      const state = await application.loadSessionState(profileId);
      const relayCdpUrl =
        state?.status === "running" ? state.relay_cdp_url : undefined;
      return relayCdpUrl ? { relayCdpUrl } : undefined;
    },
    coordinatorStop: async (profileId) =>
      unwrapApplicationResult(await application.lifecycle.stop(profileId)),
    coordinatorForceStop: async (profileId) =>
      unwrapApplicationResult(await application.lifecycle.forceStop(profileId)),
  });
  application.setRuntimeStop(browser.runtimeStop);
  const remote = includeRemoteTools
    ? await createRemoteDependencies(application).catch((error: unknown) => {
        if (
          remoteConnection === "optional" &&
          error instanceof SetupRequiredError
        )
          return {};
        throw error;
      })
    : {};
  const lifecycle: LifecycleOperations = {
    start: async (profileId) =>
      unwrapApplicationResult(await application.lifecycle.start(profileId)),
    stop: async (profileId) =>
      unwrapApplicationResult(await application.lifecycle.stop(profileId)),
    forceStop: async (profileId) =>
      unwrapApplicationResult(await application.lifecycle.forceStop(profileId)),
  };
  return {
    lifecycle,
    binaryInitialization: {
      initialize: (source: "free" | "license") =>
        application.binary.initialize(source),
      status: () => application.binary.initializationStatus(),
    },
    browserRouter: browser.router,
    browserLifecycle: browser.lifecycle,
    browserTools: visibleTools(
      process.env.BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE === "1",
    ),
    ...remote,
    close: () => application.close(),
  };
}

export async function createMcpRuntime(
  options: McpRuntimeOptions = {},
): Promise<McpRuntime> {
  const root = options.stateRoot ?? resolveStateRoot();
  const stopLog =
    options.log === false
      ? async () => undefined
      : await diagnosticLogger(root);
  const runtime =
    options.runtime ??
    (await defaultRuntime(
      root,
      options.includeRemoteTools ?? false,
      options.remoteConnection ?? "required",
    ));
  const registry = runtime.registry ?? (await createRegistry(runtime));
  let closed = false;
  return {
    registry,
    close: async () => {
      if (closed) return;
      closed = true;
      const shutdown = Promise.allSettled([
        registry.shutdown(),
        runtime.close?.(),
      ]);
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        shutdown,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 4_500);
          timer.unref?.();
        }),
      ]);
      if (timer) clearTimeout(timer);
      await stopLog();
    },
  };
}
