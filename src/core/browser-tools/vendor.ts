import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  JsonObject,
  VendorBrowserRuntime,
  VendorCallResult,
  VendorTool,
} from "./types";
import { PRODUCT_TOOLS } from "./manifest";

const require = createRequire(import.meta.url);
const DEFAULT_ACTION_TIMEOUT_MS = 30_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 90_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_CALL_TIMEOUT_MS = 180_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 10_000;
const MAX_STDERR_BYTES = 64 * 1024;

export const F2_VENDOR_TRANSLATIONS = {
  browser_run_code_unsafe: ["browser_evaluate"],
  browser_tabs: [
    "browser_tab_list",
    "browser_tab_new",
    "browser_tab_close",
    "browser_tab_select",
  ],
} as const;

type StdioTransport = StdioClientTransport;
export type VendorTransportFactory = (
  params: StdioServerParameters,
) => StdioTransport;

export type F2VendorFactoryOptions = {
  relayCdpUrl: string;
  profileId: string;
  nodeCommand?: string;
  cliPath?: string;
  transportFactory?: VendorTransportFactory;
  startupTimeoutMs?: number;
  callTimeoutMs?: number;
  closeTimeoutMs?: number;
  actionTimeoutMs?: number;
  navigationTimeoutMs?: number;
  onStderr?: (text: string) => void;
};

const withTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const childEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

const redactStderr = (text: string): string =>
  text
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(
      /(token|secret|password|api[_-]?key)\s*[=:]\s*[^\s]+/gi,
      "$1=[REDACTED]",
    );

const resolveCliPath = (): string => {
  const packageJson = require.resolve("@playwright/mcp/package.json");
  return join(dirname(packageJson), "cli.js");
};

function translateToolCall(
  name: string,
  arguments_: JsonObject,
): { name: string; arguments: JsonObject } {
  const action = arguments_.action;
  if (name === "browser_tabs") {
    if (action === "new")
      return { name: "browser_tab_new", arguments: { url: arguments_.url } };
    if (action === "close" || action === "select")
      return {
        name: action === "close" ? "browser_tab_close" : "browser_tab_select",
        arguments: { index: arguments_.index },
      };
    return { name: "browser_tab_list", arguments: {} };
  }
  if (name === "browser_run_code_unsafe")
    return {
      name: "browser_evaluate",
      arguments: { function: arguments_.code, filename: arguments_.filename },
    };
  return { name, arguments: arguments_ };
}

function validateVendorTranslations(toolNames: Set<string>): void {
  for (const names of Object.values(F2_VENDOR_TRANSLATIONS)) {
    for (const name of names) {
      if (!toolNames.has(name)) throw new Error("vendor capability mismatch");
    }
  }
}

class StdioVendorBrowserRuntime implements VendorBrowserRuntime {
  private closed = false;
  private crashed = false;

  constructor(
    private readonly client: Client,
    private readonly transport: StdioTransport,
    private readonly callTimeoutMs: number,
    private readonly closeTimeoutMs: number,
  ) {
    transport.onclose = () => {
      this.crashed = true;
    };
  }

  async listTools(): Promise<VendorTool[]> {
    if (this.closed || this.crashed) throw new Error("vendor child stopped");
    const result = await withTimeout(
      this.client.listTools(),
      DEFAULT_STARTUP_TIMEOUT_MS,
      "vendor tools/list timed out",
    );
    validateVendorTranslations(new Set(result.tools.map((tool) => tool.name)));
    return PRODUCT_TOOLS.map((tool) => ({
      ...tool,
      inputSchema: structuredClone(tool.inputSchema),
    }));
  }

  async callTool(
    name: string,
    arguments_: JsonObject,
  ): Promise<VendorCallResult> {
    if (this.closed || this.crashed) throw new Error("vendor child stopped");
    const translated = translateToolCall(name, arguments_);
    try {
      return (await withTimeout(
        this.client.callTool(translated),
        this.callTimeoutMs,
        "vendor tool call timed out",
      )) as VendorCallResult;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await withTimeout(
      this.client.close(),
      this.closeTimeoutMs,
      "vendor child close timed out",
    ).catch(() => undefined);
    await withTimeout(
      this.transport.close(),
      this.closeTimeoutMs,
      "vendor transport close timed out",
    ).catch(() => undefined);
  }
}

export async function createF2VendorRuntime(
  options: F2VendorFactoryOptions,
): Promise<VendorBrowserRuntime> {
  if (!options.relayCdpUrl) throw new Error("relay CDP URL is required");
  const cliPath = options.cliPath ?? resolveCliPath();
  const params: StdioServerParameters = {
    command:
      options.nodeCommand ?? process.env.BROWSERLOGIN_NODE_PATH ?? "node",
    args: [
      cliPath,
      "--cdp-endpoint",
      options.relayCdpUrl,
      "--timeout-action",
      String(options.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS),
      "--timeout-navigation",
      String(options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS),
    ],
    env: { ...childEnv(), PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
    stderr: "pipe",
    maxBufferSize: 10 * 1024 * 1024,
  };
  const transport = (
    options.transportFactory ?? ((input) => new StdioClientTransport(input))
  )(params);
  const stderr = transport.stderr;
  let stderrBytes = 0;
  stderr?.on("data", (chunk: Buffer) => {
    if (stderrBytes >= MAX_STDERR_BYTES) return;
    const text = chunk.toString("utf8");
    stderrBytes += Buffer.byteLength(text);
    options.onStderr?.(redactStderr(text).slice(0, MAX_STDERR_BYTES));
  });
  const client = new Client(
    { name: `browserlogin-${options.profileId}`, version: "0.1.0" },
    { capabilities: {} },
  );
  try {
    await withTimeout(
      client.connect(transport),
      options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      "vendor child startup timed out",
    );
    const runtime = new StdioVendorBrowserRuntime(
      client,
      transport,
      options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
      options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS,
    );
    await withTimeout(
      runtime.listTools(),
      options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      "vendor tools/list timed out",
    );
    return runtime;
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }
}
