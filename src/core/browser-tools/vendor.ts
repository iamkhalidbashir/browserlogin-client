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
import {
  childEnv,
  redactStderr,
  resolveCliPath,
  resolveVendorCommand,
  vendorOutputDirectory,
} from "./vendor-command";
import {
  normalizeToolResult,
  translateToolCall,
  validateVendorTranslations,
} from "./vendor-tools";

export { vendorHelperName, vendorOutputDirectory } from "./vendor-command";
export { F2_VENDOR_TRANSLATIONS } from "./vendor-tools";

const DEFAULT_ACTION_TIMEOUT_MS = 30_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 90_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_CALL_TIMEOUT_MS = 180_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 10_000;
const MAX_STDERR_BYTES = 64 * 1024;

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
      const result = (await withTimeout(
        this.client.callTool(translated),
        this.callTimeoutMs,
        "vendor tool call timed out",
      )) as VendorCallResult;
      return normalizeToolResult(name, result);
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
      "--output-dir",
      vendorOutputDirectory(),
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
