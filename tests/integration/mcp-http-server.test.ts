import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AttentionService } from "../../src/core/attention/index.js";
import type { ServerRuntime } from "../../src/mcp/runtime.js";
import { startLocalMcpHttpServer } from "../../src/mcp/http-server.js";
import {
  REMOTE_TOOL_NAMES,
  startRemoteMcpMock,
} from "../mocks/remote-mcp-server.js";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function localRuntime(attentionService?: AttentionService): ServerRuntime {
  return {
    lifecycle: {
      start: async () => undefined,
      stop: async () => undefined,
      forceStop: async () => undefined,
    },
    browserRouter: {
      call: async () => ({ content: [] }),
    },
    browserTools: [],
    ...(attentionService ? { attentionService } : {}),
  };
}

function statusForHost(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      url,
      { method: "GET", headers: { host } },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
      },
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
}

describe("local MCP Streamable HTTP server", () => {
  test("closes the runtime when the loopback port is already in use", async () => {
    const occupied = createServer();
    await new Promise<void>((resolve, reject) => {
      occupied.once("error", reject);
      occupied.listen(0, "127.0.0.1", resolve);
    });
    const address = occupied.address();
    if (!address || typeof address === "string")
      throw new Error("occupied test server did not bind to TCP");
    const closeRuntime = vi.fn(async () => undefined);

    try {
      await expect(
        startLocalMcpHttpServer({
          port: address.port,
          runtime: { ...localRuntime(), close: closeRuntime },
        }),
      ).rejects.toThrow();
      expect(closeRuntime).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        occupied.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test("lists lifecycle tools when a client connects over loopback HTTP", async () => {
    // Given
    const active = await startLocalMcpHttpServer({
      port: 0,
      runtime: localRuntime(),
    });
    const client = new Client({
      name: "browserlogin-http-integration",
      version: "1.0.0",
    });

    try {
      // When
      await client.connect(
        new StreamableHTTPClientTransport(new URL(active.url)),
      );
      const result = await client.listTools();

      // Then
      expect(result.tools.map((tool) => tool.name)).toContain(
        "browser_session_start",
      );
    } finally {
      await client.close();
      await active.close();
    }
  });

  test("calls the injected attention service over loopback HTTP", async () => {
    // Given
    const requestAttention = vi.fn(async () => ({
      code: "ATTENTION_SUBMITTED" as const,
      audio: "submitted" as const,
      notification: "submitted" as const,
    }));
    const shutdown = vi.fn(async () => undefined);
    const active = await startLocalMcpHttpServer({
      port: 0,
      runtime: localRuntime({ request: requestAttention, shutdown }),
    });
    const client = new Client({
      name: "browserlogin-http-attention",
      version: "1.0.0",
    });

    try {
      // When
      await client.connect(
        new StreamableHTTPClientTransport(new URL(active.url)),
      );
      const result = await client.callTool({
        name: "browserlogin_request_attention",
        arguments: { title: "Approval needed", message: "Review the result" },
      });

      // Then
      expect(requestAttention).toHaveBeenCalledWith(
        { title: "Approval needed", message: "Review the result" },
        expect.any(AbortSignal),
      );
      expect(result).toMatchObject({
        isError: false,
        structuredContent: {
          code: "ATTENTION_SUBMITTED",
          audio: "submitted",
          notification: "submitted",
        },
      });
    } finally {
      await client.close();
      await active.close();
    }

    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  test("merges local and workspace tools after connection setup", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "browserlogin-http-merged-"));
    roots.push(root);
    const remote = await startRemoteMcpMock();
    const nativeFetch = globalThis.fetch;
    vi.stubEnv("BROWSERLOGIN_API_KEY", "bl_test_key_secret");
    vi.stubEnv("BROWSERLOGIN_BASE_URL", "https://browserlogin.test");
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return url.startsWith("https://browserlogin.test/")
        ? nativeFetch(remote.url, init)
        : nativeFetch(input, init);
    });

    try {
      const active = await startLocalMcpHttpServer({
        port: 0,
        stateRoot: root,
      });
      const client = new Client({
        name: "browserlogin-http-merged",
        version: "1.0.0",
      });

      try {
        // When
        await client.connect(
          new StreamableHTTPClientTransport(new URL(active.url)),
        );
        const result = await client.listTools();
        const workspaceResult = await client.callTool({
          name: "profiles_list",
          arguments: {},
        });

        // Then
        expect(result.tools).toHaveLength(46);
        expect(result.tools.map((tool) => tool.name)).toEqual(
          expect.arrayContaining([...REMOTE_TOOL_NAMES]),
        );
        expect(workspaceResult.isError).not.toBe(true);
        expect(remote.callAttempts).toBe(1);
      } finally {
        await client.close();
        await active.close();
      }
    } finally {
      await remote.close();
    }
  });

  test("starts with local tools before connection setup", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "browserlogin-http-empty-"));
    roots.push(root);
    const active = await startLocalMcpHttpServer({ port: 0, stateRoot: root });
    const client = new Client({
      name: "browserlogin-http-empty-state",
      version: "1.0.0",
    });

    try {
      // When
      await client.connect(
        new StreamableHTTPClientTransport(new URL(active.url)),
      );
      const result = await client.listTools();

      // Then
      expect(result.tools).toHaveLength(29);
      expect(result.tools.map((tool) => tool.name)).not.toContain(
        "profiles_list",
      );
    } finally {
      await client.close();
      await active.close();
    }
  });

  test("rejects a forged Host header", async () => {
    // Given
    const active = await startLocalMcpHttpServer({
      port: 0,
      runtime: localRuntime(),
    });

    try {
      // When
      const status = await statusForHost(active.url, "attacker.invalid");

      // Then
      expect(status).toBe(403);
    } finally {
      await active.close();
    }
  });
});
