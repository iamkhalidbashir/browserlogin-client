import { writeSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Implementation,
} from "@modelcontextprotocol/sdk/types.js";
import { SetupRequiredError } from "../core/config/connection.js";
import { VERSION } from "../shared/version.js";
import { argumentsForCall, type UnifiedRegistry } from "./registry.js";
import { createMcpRuntime, type McpRuntimeOptions } from "./runtime.js";

const SETUP_MESSAGE = "BrowserLogin connection setup is required";

export function createMcpProtocolServer(
  registry: UnifiedRegistry,
  instructions?: string,
): Server {
  const server = new Server(
    { name: "browserlogin-client", version: VERSION } satisfies Implementation,
    {
      capabilities: { tools: {} },
      ...(instructions ? { instructions } : {}),
    },
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
  return server;
}

export async function createMcpServer(
  options: McpRuntimeOptions = {},
): Promise<{
  server: Server;
  registry: UnifiedRegistry;
  close: () => Promise<void>;
}> {
  const runtime = await createMcpRuntime({
    ...options,
    includeRemoteTools: options.includeRemoteTools ?? true,
  });
  const instructions = runtime.registry.degraded
    ? "Remote BrowserSessionMCP tools are unavailable; the server is operating in degraded local-only mode."
    : undefined;
  const server = createMcpProtocolServer(runtime.registry, instructions);
  let closed = false;
  return {
    server,
    registry: runtime.registry,
    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.allSettled([
        runtime.close(),
        server.close().catch(() => undefined),
      ]);
    },
  };
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

export async function runMcpServer(
  options: McpRuntimeOptions = {},
  createServer: typeof createMcpServer = createMcpServer,
): Promise<void> {
  const restoreGuard = installStdoutGuard();
  let active: Awaited<ReturnType<typeof createMcpServer>> | undefined;
  let transport: StdioServerTransport | undefined;
  let shutdownRequested = false;
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = async () => {
    shutdownRequested = true;
    if (!active) return;
    shutdownPromise ??= active.close();
    await shutdownPromise;
  };
  const onSignal = () => {
    void transport?.close();
    void shutdown();
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  try {
    active = await createServer(options);
    if (shutdownRequested) return;
    transport = new StdioServerTransport();
    process.stdin.once("end", onSignal);
    const closed = new Promise<void>((resolve) => {
      transport!.onclose = () => {
        void shutdown().then(resolve, () => resolve());
      };
    });
    await active.server.connect(transport);
    await closed;
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
