import { createRequire } from "node:module";
import { accessSync, constants as fsConstants } from "node:fs";
import { basename, dirname, join } from "node:path";
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
import { SOURCE_MANIFEST_TOOL_NAMES } from "./manifest";

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
  onToolsList?: (names: string[]) => void;
  extraEnv?: Record<string, string>;
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

const SAFE_PARENT_ENV = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LANGUAGE",
  "TZ",
] as const;

const SENSITIVE_ENV =
  /(api[_-]?key|license|proxy|token|secret|password|credential|auth)/i;

const childEnv = (
  extraEnv: Record<string, string> = {},
): Record<string, string> => {
  for (const key of Object.keys(extraEnv)) {
    if (SENSITIVE_ENV.test(key))
      throw new Error("unsafe child environment key");
  }
  const selected = Object.fromEntries(
    SAFE_PARENT_ENV.flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key] as string]],
    ),
  );
  return {
    ...selected,
    PWTEST_SOCKETS_DIR:
      process.env.PWTEST_SOCKETS_DIR ??
      (process.platform === "win32" ? (process.env.TEMP ?? ".") : "/tmp"),
    ...extraEnv,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
  };
};

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

export const vendorHelperName = (): string => {
  if (process.platform === "darwin" && process.arch === "arm64")
    return "browserlogin-browser-tools-macos-arm64";
  if (process.platform === "linux" && process.arch === "x64")
    return "browserlogin-browser-tools-linux-x64";
  if (process.platform === "win32" && process.arch === "x64")
    return "browserlogin-browser-tools-windows-x64.exe";
  throw new Error("browser tools helper platform is unsupported");
};

const executable = (path: string): boolean => {
  try {
    accessSync(
      path,
      process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
};

const resolveVendorCommand = (
  options: F2VendorFactoryOptions,
  cliPath: string,
): { command: string; prefix: string[] } => {
  if (options.nodeCommand)
    return { command: options.nodeCommand, prefix: [cliPath] };
  const explicitHelper = process.env.BROWSERLOGIN_BROWSER_TOOLS_HELPER;
  if (explicitHelper) {
    if (!executable(explicitHelper))
      throw new Error("packaged browser tools helper is unavailable");
    return { command: explicitHelper, prefix: [] };
  }
  if (/^bun(?:\.exe)?$/i.test(basename(process.execPath)))
    return {
      command: process.env.BROWSERLOGIN_NODE_PATH ?? "node",
      prefix: [cliPath],
    };
  const name = vendorHelperName();
  const candidates = [
    join(dirname(process.execPath), name),
    process.argv[1]
      ? join(dirname(process.argv[1]), "vendor", name)
      : undefined,
    join(import.meta.dir, "vendor", name),
    join(process.cwd(), "dist", "vendor", name),
  ].filter((value): value is string => Boolean(value));
  const helper = candidates.find(executable);
  if (!helper) throw new Error("packaged browser tools helper is unavailable");
  return { command: helper, prefix: [] };
};

function translateToolCall(
  name: string,
  arguments_: JsonObject,
  toolNames: Set<string>,
): { name: string; arguments: JsonObject } {
  const action = arguments_.action;
  if (name === "browser_tabs" && !toolNames.has("browser_tabs")) {
    if (action === "new")
      return { name: "browser_tab_new", arguments: { url: arguments_.url } };
    if (action === "close" || action === "select")
      return {
        name: action === "close" ? "browser_tab_close" : "browser_tab_select",
        arguments: { index: arguments_.index },
      };
    return { name: "browser_tab_list", arguments: {} };
  }
  if (
    name === "browser_run_code_unsafe" &&
    !toolNames.has("browser_run_code_unsafe")
  )
    return {
      name: "browser_evaluate",
      arguments: { function: arguments_.code, filename: arguments_.filename },
    };
  return { name, arguments: arguments_ };
}

function validateVendorTranslations(toolNames: Set<string>): Set<string> {
  const routerOwned = new Set([
    "browser_close",
    "browser_fill_form",
    "browser_select_option",
    "browser_tabs",
    "browser_run_code_unsafe",
  ]);
  const required = new Set<string>(
    SOURCE_MANIFEST_TOOL_NAMES.filter((name) => !routerOwned.has(name)),
  );
  for (const name of required) {
    if (toolNames.has(name)) continue;
    throw new Error("vendor capability mismatch");
  }
  const hasTabsTranslation = [
    "browser_tab_list",
    "browser_tab_new",
    "browser_tab_close",
    "browser_tab_select",
  ].every((translated) => toolNames.has(translated));
  if (!toolNames.has("browser_tabs") && !hasTabsTranslation)
    throw new Error("vendor capability mismatch");
  if (
    !toolNames.has("browser_run_code_unsafe") &&
    !toolNames.has("browser_evaluate")
  )
    throw new Error("vendor capability mismatch");
  return toolNames;
}

class StdioVendorBrowserRuntime implements VendorBrowserRuntime {
  private closed = false;
  private crashed = false;

  constructor(
    private readonly client: Client,
    private readonly transport: StdioTransport,
    private readonly callTimeoutMs: number,
    private readonly closeTimeoutMs: number,
    private readonly onToolsList?: (names: string[]) => void,
    private readonly toolNames = new Set<string>(),
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
    const toolNames = result.tools.map((tool) => tool.name as string);
    this.onToolsList?.(toolNames);
    const validated = validateVendorTranslations(new Set(toolNames));
    this.toolNames.clear();
    for (const name of validated) this.toolNames.add(name);
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
    const translated = translateToolCall(name, arguments_, this.toolNames);
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
  const resolved = resolveVendorCommand(options, cliPath);
  const params: StdioServerParameters = {
    command: resolved.command,
    args: [
      ...resolved.prefix,
      "--cdp-endpoint",
      options.relayCdpUrl,
      "--timeout-action",
      String(options.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS),
      "--timeout-navigation",
      String(options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS),
    ],
    env: childEnv(options.extraEnv),
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
      options.onToolsList,
    );
    await withTimeout(
      runtime.listTools(),
      options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      "vendor tools/list timed out",
    );
    return runtime;
  } catch (error) {
    await withTimeout(
      transport.close(),
      options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS,
      "vendor transport close timed out",
    ).catch(() => undefined);
    throw error;
  }
}
