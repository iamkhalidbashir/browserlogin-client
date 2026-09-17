import type {
  IncomingMessage,
  Server as NodeHttpServer,
  ServerResponse,
} from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  LOCAL_MCP_HOST,
  LOCAL_MCP_PATH,
  LOCAL_MCP_PORT,
} from "../shared/mcp-endpoints.js";
import { createMcpProtocolServer } from "./server.js";
import {
  createMcpRuntime,
  type McpRuntimeOptions,
  type ServerRuntime,
} from "./runtime.js";

export type LocalMcpHttpServerOptions = {
  readonly port?: number;
  readonly stateRoot?: string;
  readonly runtime?: ServerRuntime;
};

export type LocalMcpHttpServer = {
  readonly url: string;
  close(): Promise<void>;
};

type ProtocolConnection = {
  readonly server: ReturnType<typeof createMcpProtocolServer>;
  readonly transport: StreamableHTTPServerTransport;
};

type JsonRequest = IncomingMessage & { readonly body?: unknown };
type JsonResponse = ServerResponse & {
  status(code: number): JsonResponse;
  json(body: unknown): void;
};
type NextHandler = (error?: unknown) => void;

class LocalMcpAddressError extends Error {
  constructor() {
    super("Local MCP server did not bind to a TCP address");
    this.name = "LocalMcpAddressError";
  }
}

function listen(
  app: ReturnType<typeof createMcpExpressApp>,
  port: number,
): Promise<NodeHttpServer> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, LOCAL_MCP_HOST, () => {
      server.off("error", reject);
      resolve(server);
    });
    server.once("error", reject);
  });
}

function closeListener(server: NodeHttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function closeProtocol(active: ProtocolConnection): Promise<void> {
  await Promise.allSettled([active.transport.close(), active.server.close()]);
}

export async function startLocalMcpHttpServer(
  options: LocalMcpHttpServerOptions = {},
): Promise<LocalMcpHttpServer> {
  const runtimeOptions: McpRuntimeOptions = {
    log: false,
    includeRemoteTools: true,
    remoteConnection: "optional",
    ...(options.stateRoot ? { stateRoot: options.stateRoot } : {}),
    ...(options.runtime ? { runtime: options.runtime } : {}),
  };
  const runtime = await createMcpRuntime(runtimeOptions);
  const protocols = new Set<ProtocolConnection>();
  const app = createMcpExpressApp({ host: LOCAL_MCP_HOST });

  app.post(
    LOCAL_MCP_PATH,
    async (request: JsonRequest, response: JsonResponse, next: NextHandler) => {
      const active: ProtocolConnection = {
        server: createMcpProtocolServer(runtime.registry),
        transport: new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        }),
      };
      protocols.add(active);
      response.once("close", () => {
        protocols.delete(active);
        void closeProtocol(active);
      });
      try {
        await active.server.connect(active.transport);
        await active.transport.handleRequest(request, response, request.body);
      } catch (error) {
        protocols.delete(active);
        await closeProtocol(active);
        next(error);
      }
    },
  );
  app.get(LOCAL_MCP_PATH, (_request: JsonRequest, response: JsonResponse) => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32_000, message: "Method not allowed." },
      id: null,
    });
  });
  app.delete(
    LOCAL_MCP_PATH,
    (_request: JsonRequest, response: JsonResponse) => {
      response.status(405).json({
        jsonrpc: "2.0",
        error: { code: -32_000, message: "Method not allowed." },
        id: null,
      });
    },
  );

  let listener: NodeHttpServer | undefined;
  try {
    listener = await listen(app, options.port ?? LOCAL_MCP_PORT);
    const address = listener.address();
    if (!address || typeof address === "string")
      throw new LocalMcpAddressError();
  } catch (error) {
    await Promise.allSettled([
      ...(listener ? [closeListener(listener)] : []),
      runtime.close(),
    ]);
    throw error;
  }
  const address = listener.address();
  if (!address || typeof address === "string") throw new LocalMcpAddressError();
  let closed = false;
  return {
    url: `http://${LOCAL_MCP_HOST}:${address.port}${LOCAL_MCP_PATH}`,
    close: async () => {
      if (closed) return;
      closed = true;
      const results = await Promise.allSettled([
        ...[...protocols].map(closeProtocol),
        closeListener(listener),
        runtime.close(),
      ]);
      protocols.clear();
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failure) throw failure.reason;
    },
  };
}
