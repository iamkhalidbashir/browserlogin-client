import { startServer, sendEmpty, sendJson } from "./http.js";

export const REMOTE_TOOL_NAMES = [
  "profiles_list",
  "profile_get",
  "profile_create",
  "profile_update",
  "profile_delete",
  "profile_restore",
  "notes_get",
  "notes_append",
  "notes_update",
  "proxies_list",
  "proxy_change_ip",
  "members_list",
  "member_share",
  "member_remove",
  "users_list",
  "user_disable",
  "audit_list",
] as const;
const supportedVersions = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

export type RemoteMcpMockOptions = {
  unauthorized?: boolean;
  blockCalls?: boolean | number;
  redirectTo?: string;
  oversized?: boolean;
  initializeVersion?: string;
  collisionName?: string;
  callStatus?: number;
};

export type RemoteMcpMockServer = Awaited<ReturnType<typeof startServer>> & {
  readonly callAttempts: number;
};

export async function startRemoteMcpMock(
  options: RemoteMcpMockOptions = {},
): Promise<RemoteMcpMockServer> {
  let blockedCalls =
    typeof options.blockCalls === "number"
      ? options.blockCalls
      : options.blockCalls
        ? 1
        : 0;
  let callAttempts = 0;
  const server = await startServer(async ({ request, json }, response) => {
    if (options.redirectTo)
      return sendEmpty(response, 302, { Location: options.redirectTo });
    if (request.method === "GET" || request.method === "DELETE")
      return sendEmpty(response, 405, { Allow: "POST" });
    if (json && !Array.isArray(json) && json.method === "tools/call")
      callAttempts += 1;
    if (
      options.unauthorized ||
      request.headers.authorization !== "Bearer bl_test_key_secret"
    )
      return sendJson(
        response,
        401,
        { error: "unauthorized" },
        { "WWW-Authenticate": 'Bearer realm="BrowserLogin"' },
      );
    if (request.headers["content-type"]?.split(";")[0] !== "application/json")
      return sendJson(response, 415, {
        error: "Content-Type must be application/json",
      });
    const message = json && !Array.isArray(json) ? json : {};
    const id = message.id;
    const method = message.method;
    if (method === "initialize") {
      const params =
        message.params && typeof message.params === "object"
          ? (message.params as Record<string, unknown>)
          : {};
      const requested =
        options.initializeVersion ??
        (typeof params.protocolVersion === "string" &&
        supportedVersions.includes(params.protocolVersion)
          ? params.protocolVersion
          : supportedVersions[0]);
      return sendJson(response, 200, {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: requested,
          capabilities: { tools: {} },
          serverInfo: { name: "browserSessionMCP", version: "2.1.0" },
        },
      });
    }
    if (method === "notifications/initialized") return sendEmpty(response, 202);
    if (method === "ping")
      return sendJson(response, 200, { jsonrpc: "2.0", id, result: {} });
    if (method === "tools/list") {
      const names = options.collisionName
        ? [...REMOTE_TOOL_NAMES, options.collisionName]
        : [...REMOTE_TOOL_NAMES];
      const tools = names.map((name) => ({
        name,
        description: `BrowserLogin ${name}`,
        inputSchema: { type: "object" },
      }));
      if (options.oversized)
        tools[0] = {
          name: tools[0]!.name,
          description: "x".repeat(256 * 1024),
          inputSchema: { type: "object" },
        };
      return sendJson(response, 200, {
        jsonrpc: "2.0",
        id,
        result: { structuredContent: { result: tools } },
      });
    }
    if (method === "tools/call") {
      if (blockedCalls > 0) {
        blockedCalls -= 1;
        await new Promise<void>((resolve) => {
          request.once("aborted", resolve);
          request.once("close", resolve);
        });
        response.destroy();
        return;
      }
      if (options.callStatus)
        return sendJson(response, options.callStatus, { error: "call failed" });
      const params =
        message.params && typeof message.params === "object"
          ? (message.params as Record<string, unknown>)
          : {};
      if (
        typeof params.name !== "string" ||
        !REMOTE_TOOL_NAMES.includes(
          params.name as (typeof REMOTE_TOOL_NAMES)[number],
        )
      )
        return sendJson(response, 200, {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "unknown tool" },
        });
      return sendJson(response, 200, {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({ tool: params.name, ok: true }),
            },
          ],
          structuredContent: { result: { tool: params.name, ok: true } },
          isError: false,
        },
      });
    }
    return sendJson(response, 200, {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "method not found" },
    });
  });
  return {
    ...server,
    get callAttempts() {
      return callAttempts;
    },
  };
}
