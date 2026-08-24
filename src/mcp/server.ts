import { writeSync } from "node:fs";
import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Implementation,
} from "@modelcontextprotocol/sdk/types.js";
import { createBrowserTools } from "../core/browser-tools/factory.js";
import { visibleTools } from "../core/browser-tools/manifest.js";
import {
  ConnectionStore,
  SetupRequiredError,
} from "../core/config/connection.js";
import { resolveStateRoot } from "../core/config/paths.js";
import { createKeychainBackend } from "../core/keychain/index.js";
import { RemoteMcpClient } from "../core/mcp-proxy/client.js";
import { RemoteMcpDiscoveryCache } from "../core/mcp-proxy/cache.js";
import { RemoteMcpForwarder } from "../core/mcp-proxy/forward.js";
import {
  createApplicationRuntime,
  unwrapApplicationResult,
} from "../core/app/index.js";
import { VERSION } from "../shared/version.js";
import {
  argumentsForCall,
  createRegistry,
  localToolNames,
  type LifecycleOperations,
  type RegistryDependencies,
  type UnifiedRegistry,
} from "./registry.js";

const SETUP_MESSAGE = "BrowserLogin connection setup is required";
const LOG_LIMIT = 256 * 1024;

export type ServerRuntime = RegistryDependencies & {
  registry?: UnifiedRegistry;
  close?: () => Promise<void>;
};

export type ServerOptions = {
  runtime?: ServerRuntime;
  stateRoot?: string;
  log?: boolean;
};

async function rotateLog(path: string): Promise<void> {
  try {
    if ((await stat(path)).size > LOG_LIMIT)
      await rename(path, `${path}.1`).catch(() => undefined);
  } catch {
    return;
  }
}

function installStdoutGuard(): () => void {
  const original = console.log;
  console.log = (...values: unknown[]) => {
    process.stderr.write(`${values.map(String).join(" ")}\n`);
  };
  return () => {
    console.log = original;
  };
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

async function defaultRuntime(root: string): Promise<ServerRuntime> {
  const keychain = createKeychainBackend();
  const store = new ConnectionStore(root, keychain);
  try {
    const envKey =
      process.env.BROWSERLOGIN_API_KEY?.trim() ||
      process.env.CLOAKBROWSER_API_KEY?.trim();
    if (!envKey && (await store.read()) === null)
      throw new SetupRequiredError();
  } catch {
    throw new SetupRequiredError();
  }
  const application = createApplicationRuntime({
    root,
    connection: store,
    keychain,
  });
  const resolution = await application.remoteConnection().catch(() => {
    throw new SetupRequiredError();
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
  const remoteClient = new RemoteMcpClient({
    url: resolution.remoteMcpUrl,
    credentials: resolution.credentials,
  });
  const remoteCache = new RemoteMcpDiscoveryCache(remoteClient);
  const remoteForwarder = new RemoteMcpForwarder(
    remoteClient,
    localToolNames(),
  );
  const lifecycle: LifecycleOperations = {
    start: async (profileId) =>
      unwrapApplicationResult(await application.lifecycle.start(profileId)),
    stop: async (profileId) =>
      unwrapApplicationResult(await application.lifecycle.stop(profileId)),
    forceStop: async (profileId) =>
      unwrapApplicationResult(await application.lifecycle.forceStop(profileId)),
  };
  const binaryInitialization = {
    initialize: (source: "free" | "license") =>
      application.binary.initialize(source),
    status: () => application.binary.initializationStatus(),
  };
  const browserTools = visibleTools(
    process.env.BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE === "1",
  );
  return {
    lifecycle,
    binaryInitialization,
    browserRouter: browser.router,
    browserLifecycle: browser.lifecycle,
    browserTools,
    remoteCache,
    remoteForwarder,
    close: () => application.close(),
  };
}

export async function createMcpServer(options: ServerOptions = {}): Promise<{
  server: Server;
  registry: UnifiedRegistry;
  close: () => Promise<void>;
}> {
  const root = options.stateRoot ?? resolveStateRoot();
  const stopLog =
    options.log === false
      ? async () => undefined
      : await diagnosticLogger(root);
  const runtime = options.runtime ?? (await defaultRuntime(root));
  const registry = runtime.registry ?? (await createRegistry(runtime));
  const instructions = registry.degraded
    ? "Remote BrowserSessionMCP tools are unavailable; the server is operating in degraded local-only mode."
    : undefined;
  const server = new Server(
    { name: "browserlogin-client", version: VERSION } satisfies Implementation,
    { capabilities: { tools: {} }, ...(instructions ? { instructions } : {}) },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...registry.tools],
  }));
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request, extra): Promise<CallToolResult> =>
      registry.call(
        request.params.name,
        argumentsForCall(request.params.arguments),
        extra.signal,
      ),
  );
  let closed = false;
  const close = async () => {
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
    await server.close().catch(() => undefined);
  };
  return { server, registry, close };
}

export async function runMcpServer(options: ServerOptions = {}): Promise<void> {
  const restoreGuard = installStdoutGuard();
  let active: Awaited<ReturnType<typeof createMcpServer>> | undefined;
  let transport: StdioServerTransport | undefined;
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await active?.close();
  };
  const onSignal = () => {
    void transport?.close();
    void shutdown();
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  try {
    active = await createMcpServer(options);
    transport = new StdioServerTransport();
    process.stdin.once("end", onSignal);
    await active.server.connect(transport);
    await new Promise<void>((resolve) => {
      transport!.onclose = () => {
        void shutdown().then(resolve);
      };
    });
  } finally {
    await shutdown();
    restoreGuard();
    process.stdin.removeListener("end", onSignal);
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("SIGINT", onSignal);
  }
}

export async function main(): Promise<void> {
  try {
    await runMcpServer();
  } catch (error) {
    if (
      error instanceof SetupRequiredError ||
      (error instanceof Error && error.message === SETUP_MESSAGE)
    ) {
      writeSync(process.stderr.fd, `${SETUP_MESSAGE}\n`);
      process.exit(2);
    }
    process.stderr.write("BrowserLogin MCP server could not start\n");
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1]?.replaceAll("\\", "/");
if (
  entryPath?.endsWith("/mcp/server.ts") ||
  entryPath?.endsWith("/mcp/server.js")
)
  void main();
