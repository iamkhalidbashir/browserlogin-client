import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RemoteMcpClient,
  RemoteMcpDiscoveryCache,
  RemoteMcpError,
  RemoteMcpForwarder,
  mergeRemoteTools,
} from "../../src/core/mcp-proxy";
import {
  REMOTE_TOOL_NAMES,
  startRemoteMcpMock,
} from "../mocks/remote-mcp-server";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  while (closers.length) await closers.pop()?.();
});

describe("Task 22 remote MCP proxy", () => {
  it("uses the derived endpoint supplied by connection resolution without an environment fallback", () => {
    // Given
    vi.stubEnv(
      "BROWSERLOGIN_MCP_REMOTE_URL",
      "https://ignored.example.test/mcp/browserSessionMCP",
    );

    // When
    const client = new RemoteMcpClient({
      url: "https://configured.example.test/mcp/browserSessionMCP",
      credentials: async () => "bl_test_key_secret",
    });

    // Then
    expect(client.url).toBe(
      "https://configured.example.test/mcp/browserSessionMCP",
    );
  });

  it("discovers exactly 17 tools and forwards every call with stateless POST headers", async () => {
    const server = await startRemoteMcpMock();
    closers.push(server.close);
    const requests: Request[] = [];
    const client = new RemoteMcpClient({
      url: server.url,
      credentials: async () => "bl_test_key_secret",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request.clone());
        return fetch(request);
      },
    });
    expect(await client.initialize()).toBe("2025-11-25");
    await expect(client.initialized()).resolves.toBeUndefined();
    await expect(client.ping()).resolves.toEqual({});
    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(REMOTE_TOOL_NAMES);
    expect(tools[0]?.inputSchema).toEqual({ type: "object" });
    const forwarder = new RemoteMcpForwarder(client, new Set(["local_tool"]));
    expect(forwarder.merge(tools)).toHaveLength(17);
    for (const name of REMOTE_TOOL_NAMES) {
      const result = await forwarder.call(name, {});
      expect(result).toEqual({
        content: [
          { type: "text", text: JSON.stringify({ tool: name, ok: true }) },
        ],
        structuredContent: { result: { tool: name, ok: true } },
        isError: false,
      });
    }
    expect(requests).toHaveLength(21);
    const notification = JSON.parse(await requests[1]!.text()) as {
      method: string;
      id?: unknown;
    };
    expect(notification).toEqual({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });
    for (const request of requests) {
      expect(request.method).toBe("POST");
      expect(request.headers.get("accept")).toBe("application/json");
      expect(request.headers.get("content-type")).toBe("application/json");
      expect(request.headers.get("authorization")).toBe(
        "Bearer bl_test_key_secret",
      );
      expect(request.headers.get("origin")).toBeNull();
      expect(request.headers.get("mcp-session-id")).toBeNull();
      expect(request.headers.get("cookie")).toBeNull();
    }
  });

  it("accepts newest supported version negotiation and 202 initialized notification", async () => {
    const server = await startRemoteMcpMock({
      initializeVersion: "2024-11-05",
    });
    closers.push(server.close);
    const client = new RemoteMcpClient({
      url: server.url,
      credentials: async () => "bl_test_key_secret",
    });
    await expect(client.initialize()).resolves.toBe("2024-11-05");
    await expect(client.initialized()).resolves.toBeUndefined();
  });

  it("degrades within the discovery budget and schedules only one retry window", async () => {
    const calls: string[] = [];
    const client = new RemoteMcpClient({
      url: "http://127.0.0.1:1/mcp",
      credentials: async () => "bl_test_key_secret",
      connectTimeoutMs: 20,
      totalTimeoutMs: 50,
      fetch: async () => {
        calls.push("fetch");
        throw new Error("unreachable private endpoint");
      },
    });
    const cache = new RemoteMcpDiscoveryCache(client);
    const started = performance.now();
    await expect(cache.discover()).resolves.toEqual([]);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(cache.status).toBe("REMOTE_UNAVAILABLE");
    await expect(cache.discover()).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
    expect(cache.attempts).toBe(1);
    expect(cache.scheduledRetries).toBe(1);
    cache.shutdown();
  });

  it("marks 401 invalid, does not retry, and clears the invalid state only after credential change", async () => {
    let key = "bl_test_key_secret";
    const server = await startRemoteMcpMock({ callStatus: 401 });
    closers.push(server.close);
    const client = new RemoteMcpClient({
      url: server.url,
      credentials: async () => key,
    });
    await expect(client.callTool("profiles_list")).rejects.toMatchObject({
      remoteCode: "REMOTE_AUTH_FAILED",
    });
    await expect(client.callTool("profiles_list")).rejects.toMatchObject({
      remoteCode: "REMOTE_AUTH_FAILED",
    });
    expect(server.callAttempts).toBe(1);
    key = "bl_changed_key_secret";
    await expect(client.callTool("profiles_list")).rejects.toMatchObject({
      remoteCode: "REMOTE_AUTH_FAILED",
    });
    expect(server.callAttempts).toBe(2);
    expect(
      new RemoteMcpError("REMOTE_AUTH_FAILED", "Bearer bl_test_key_secret")
        .message,
    ).not.toContain("bl_test_key_secret");
  });

  it("propagates cancellation to a blocked upstream call and allows the next call", async () => {
    const server = await startRemoteMcpMock({ blockCalls: true });
    closers.push(server.close);
    const client = new RemoteMcpClient({
      url: server.url,
      credentials: async () => "bl_test_key_secret",
    });
    const controller = new AbortController();
    const call = client.callTool("profiles_list", {}, controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(call).rejects.toMatchObject({
      remoteCode: "REMOTE_CANCELLED",
    });
    await expect(client.callTool("profiles_list")).resolves.toMatchObject({
      isError: false,
    });
  });

  it("rejects redirects and oversized discovery metadata without forwarding unsafe behavior", async () => {
    const redirected = await startRemoteMcpMock({
      redirectTo: "https://other.invalid/mcp",
    });
    closers.push(redirected.close);
    const client = new RemoteMcpClient({
      url: redirected.url,
      credentials: async () => "bl_test_key_secret",
    });
    await expect(client.initialize()).rejects.toMatchObject({
      remoteCode: "REMOTE_REDIRECT_REJECTED",
    });
    const oversized = await startRemoteMcpMock({ oversized: true });
    closers.push(oversized.close);
    const oversizedClient = new RemoteMcpClient({
      url: oversized.url,
      credentials: async () => "bl_test_key_secret",
    });
    await oversizedClient.initialize();
    await oversizedClient.initialized();
    await expect(oversizedClient.listTools()).rejects.toMatchObject({
      remoteCode: "REMOTE_BODY_TOO_LARGE",
    });
  });

  it("lets local tools win collisions and warns with only the colliding name", async () => {
    const warning = vi.fn();
    const merged = mergeRemoteTools(
      ["browser_session_start", "browserlogin_session_start"],
      [
        { name: "browser_session_start", inputSchema: { type: "object" } },
        { name: "browserlogin_session_start", inputSchema: { type: "object" } },
        ...REMOTE_TOOL_NAMES.map((name) => ({
          name,
          inputSchema: { type: "object" },
        })),
      ],
      warning,
    );
    expect(merged.some((tool) => tool.name === "browser_session_start")).toBe(
      false,
    );
    expect(
      merged.some((tool) => tool.name === "browserlogin_session_start"),
    ).toBe(false);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("browser_session_start"),
    );
    expect(warning.mock.calls[0]?.[0]).toMatch(/browser_session_start$/);
    expect(warning.mock.calls[1]?.[0]).toMatch(/browserlogin_session_start$/);
    const forwarder = new RemoteMcpForwarder(
      { callTool: () => Promise.resolve({}) } as never,
      new Set(["local"]),
    );
    await expect(forwarder.call("local")).rejects.toMatchObject({
      remoteCode: "REMOTE_PROTOCOL_ERROR",
    });
  });
});
