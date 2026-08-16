import { startServer, sendEmpty, sendJson } from "./http.js";

export const REMOTE_TOOL_NAMES = ["profiles_list", "profile_get", "profile_create", "profile_update", "profile_delete", "profile_restore", "notes_get", "notes_append", "notes_update", "proxies_list", "proxy_change_ip", "members_list", "member_share", "member_remove", "users_list", "user_disable", "audit_list"] as const;
const supportedVersions = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export async function startRemoteMcpMock() {
  return startServer(async ({ request, json }, response) => {
    if (request.method === "GET" || request.method === "DELETE") return sendEmpty(response, 405, { Allow: "POST" });
    if (request.headers.authorization !== "Bearer bl_test_key_secret") return sendJson(response, 401, { error: "unauthorized" }, { "WWW-Authenticate": 'Bearer realm="BrowserLogin"' });
    if (request.headers["content-type"]?.split(";")[0] !== "application/json") return sendJson(response, 415, { error: "Content-Type must be application/json" });
    const message = json && !Array.isArray(json) ? json : {};
    const id = message.id;
    const method = message.method;
    if (method === "initialize") {
      const params = message.params && typeof message.params === "object" ? message.params as Record<string, unknown> : {};
      const requested = typeof params.protocolVersion === "string" && supportedVersions.includes(params.protocolVersion) ? params.protocolVersion : supportedVersions[0];
      return sendJson(response, 200, { jsonrpc: "2.0", id, result: { protocolVersion: requested, capabilities: { tools: {} }, serverInfo: { name: "browserSessionMCP", version: "2.1.0" } } });
    }
    if (method === "notifications/initialized") return sendEmpty(response, 202);
    if (method === "ping") return sendJson(response, 200, { jsonrpc: "2.0", id, result: {} });
    if (method === "tools/list") return sendJson(response, 200, { jsonrpc: "2.0", id, result: { structuredContent: { result: REMOTE_TOOL_NAMES.map(name => ({ name, description: `BrowserLogin ${name}`, inputSchema: { type: "object" } })) } } });
    if (method === "tools/call") {
      const params = message.params && typeof message.params === "object" ? message.params as Record<string, unknown> : {};
      if (typeof params.name !== "string" || !REMOTE_TOOL_NAMES.includes(params.name as typeof REMOTE_TOOL_NAMES[number])) return sendJson(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "unknown tool" } });
      return sendJson(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ tool: params.name, ok: true }) }], structuredContent: { result: { tool: params.name, ok: true } }, isError: false } });
    }
    return sendJson(response, 200, { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
  });
}
