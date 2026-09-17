import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMcpProtocolServer, runMcpServer } from "../../src/mcp/server.js";
import type { UnifiedRegistry } from "../../src/mcp/registry.js";

let child: ChildProcessWithoutNullStreams | undefined;
const roots: string[] = [];

afterEach(async () => {
  if (child && child.exitCode === null) child.kill("SIGKILL");
  child = undefined;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("standalone stdio MCP server", () => {
  test("closes a server created after shutdown was requested", async () => {
    const registry: UnifiedRegistry = {
      tools: [],
      degraded: false,
      call: async () => ({ content: [] }),
      shutdown: async () => undefined,
    };
    const server = createMcpProtocolServer(registry);
    const connect = vi.spyOn(server, "connect");
    const close = vi.fn(async () => undefined);
    let resolveStartup!: (active: {
      server: typeof server;
      registry: UnifiedRegistry;
      close: () => Promise<void>;
    }) => void;
    const startup = new Promise<{
      server: typeof server;
      registry: UnifiedRegistry;
      close: () => Promise<void>;
    }>((resolve) => {
      resolveStartup = resolve;
    });
    const existingSignals = new Set(process.listeners("SIGTERM"));
    const running = runMcpServer({}, async () => startup);
    const signal = process
      .listeners("SIGTERM")
      .find((listener) => !existingSignals.has(listener));
    if (!signal) throw new Error("stdio MCP did not install SIGTERM handler");

    signal("SIGTERM");
    resolveStartup({ server, registry, close });
    await running;

    expect(close).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
  });

  test("initializes, lists local tools, and exits cleanly on EOF", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-mcp-stdio-"));
    roots.push(root);
    child = spawn("bun", ["src/mcp/server.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BROWSERLOGIN_STATE_DIR: root,
        BROWSERLOGIN_API_KEY: "bl_test_key_secret",
        BROWSERLOGIN_BASE_URL: "https://127.0.0.1:1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout });
    const responses = lines[Symbol.asyncIterator]();
    const send = (message: Record<string, unknown>) => {
      child!.stdin.write(`${JSON.stringify(message)}\n`);
    };

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "integration-test", version: "1.0.0" },
      },
    });
    const initialized = JSON.parse(
      String((await responses.next()).value),
    ) as Record<string, unknown>;
    expect(initialized).toMatchObject({ jsonrpc: "2.0", id: 1 });

    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listed = JSON.parse(String((await responses.next()).value)) as {
      jsonrpc?: string;
      id?: number;
      result?: { tools?: unknown[] };
    };
    expect(listed).toMatchObject({ jsonrpc: "2.0", id: 2 });
    expect(listed.result?.tools).toHaveLength(28);

    const exited = once(child, "exit");
    child.stdin.end();
    const [code, signal] = await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("stdio MCP shutdown timed out")),
          5_000,
        ),
      ),
    ]);
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    lines.close();
  }, 15_000);
});
