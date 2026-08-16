import { createConnection } from "@playwright/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  JsonObject,
  VendorBrowserRuntime,
  VendorCallResult,
  VendorTool,
} from "./types";

process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";

class LoopbackTransport implements Transport {
  peer?: LoopbackTransport;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private closed = false;

  async start(): Promise<void> {}

  async send(
    message: JSONRPCMessage,
    _options?: TransportSendOptions,
  ): Promise<void> {
    void _options;
    if (this.closed || !this.peer || this.peer.closed)
      throw new Error("vendor transport is closed");
    queueMicrotask(() => this.peer?.onmessage?.(message));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
    if (this.peer && !this.peer.closed) {
      this.peer.closed = true;
      this.peer.onclose?.();
    }
  }
}

function loopbackPair(): [LoopbackTransport, LoopbackTransport] {
  const first = new LoopbackTransport();
  const second = new LoopbackTransport();
  first.peer = second;
  second.peer = first;
  return [first, second];
}

class McpVendorBrowserRuntime implements VendorBrowserRuntime {
  constructor(
    private readonly client: Client,
    private readonly server: { close(): Promise<void> },
  ) {}

  async listTools(): Promise<VendorTool[]> {
    const result = await this.client.listTools();
    return result.tools as VendorTool[];
  }

  async callTool(
    name: string,
    arguments_: JsonObject,
  ): Promise<VendorCallResult> {
    return (await this.client.callTool({
      name,
      arguments: arguments_,
    })) as VendorCallResult;
  }

  async close(): Promise<void> {
    await this.client.close();
    await this.server.close();
  }
}

export type F2VendorFactoryOptions = {
  relayCdpUrl: string;
  profileId: string;
};

export async function createF2VendorRuntime(
  options: F2VendorFactoryOptions,
): Promise<VendorBrowserRuntime> {
  if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD !== "1")
    throw new Error("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD must be 1");
  if (!options.relayCdpUrl) throw new Error("relay CDP URL is required");

  const [clientTransport, serverTransport] = loopbackPair();
  const config = {
    capabilities: ["core"] as ["core"],
    browser: { cdpEndpoint: options.relayCdpUrl },
  };
  const server = await createConnection(config);
  const client = new Client(
    { name: `browserlogin-${options.profileId}`, version: "0.1.0" },
    { capabilities: {} },
  );
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return new McpVendorBrowserRuntime(client, server);
}
