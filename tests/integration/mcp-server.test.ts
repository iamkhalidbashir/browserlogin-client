import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { REMOTE_TOOL_NAMES } from "../mocks/remote-mcp-server.js";
import { startRemoteMcpMock } from "../mocks/remote-mcp-server.js";

const BUN = process.env.BUN_BIN ?? "bun";
const SERVER = join(process.cwd(), "src/mcp/server.ts");
const API_KEY = "bl_test_key_secret";
const LOCAL_API_FAILURE = "https://127.0.0.1:1/api/v1";

type RpcId = number | string | null;
type RpcFrame = {
  jsonrpc: "2.0";
  id?: RpcId;
  method?: string;
  result?: unknown;
  error?: unknown;
};
type PendingRequest = {
  resolve: (frame: RpcFrame) => void;
  reject: (error: Error) => void;
  onExit: () => void;
};

const children: StdioHarness[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => child.stop()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function validateFrame(value: unknown, line: string): RpcFrame {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).jsonrpc !== "2.0"
  ) {
    throw new Error(`invalid JSON-RPC stdout frame: ${line}`);
  }
  return value as RpcFrame;
}

class StdioHarness {
  readonly child: ChildProcessWithoutNullStreams;
  readonly stdoutLines: string[] = [];
  readonly stdoutErrors: string[] = [];
  readonly stderrChunks: string[] = [];
  private stdoutTail = "";
  private readonly pending = new Map<RpcId, PendingRequest>();
  private exited = false;

  constructor(
    baseUrl: string,
    root: string,
    remoteUrl: string,
    apiKey = API_KEY,
  ) {
    this.child = spawn(BUN, [SERVER], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BROWSERLOGIN_STATE_DIR: root,
        BROWSERLOGIN_API_KEY: apiKey,
        BROWSERLOGIN_BASE_URL: baseUrl,
        BROWSERLOGIN_MCP_REMOTE_TOKEN: API_KEY,
        BROWSERLOGIN_MCP_REMOTE_URL: remoteUrl,
      },
      stdio: "pipe",
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk));
    this.child.stderr.on("data", (chunk: string) =>
      this.stderrChunks.push(chunk),
    );
    this.child.once("exit", () => {
      this.exited = true;
    });
  }

  get stdout(): string {
    return this.stdoutLines.join("\n");
  }

  get stderr(): string {
    return this.stderrChunks.join("");
  }

  private consumeStdout(chunk: string): void {
    this.stdoutTail += chunk;
    const lines = this.stdoutTail.split("\n");
    this.stdoutTail = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      this.stdoutLines.push(line);
      try {
        const frame = validateFrame(JSON.parse(line), line);
        if (frame.id !== undefined && this.pending.has(frame.id)) {
          const pending = this.pending.get(frame.id)!;
          this.pending.delete(frame.id);
          if (pending.onExit) this.child.off("exit", pending.onExit);
          pending.resolve(frame);
        }
      } catch (error) {
        this.stdoutErrors.push(
          error instanceof Error ? error.message : String(error),
        );
        for (const [id, pending] of this.pending) {
          this.pending.delete(id);
          if (pending.onExit) this.child.off("exit", pending.onExit);
          pending.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    }
  }

  request(
    id: number,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<RpcFrame> {
    if (this.pending.has(id)) throw new Error(`duplicate request id ${id}`);
    return new Promise<RpcFrame>((resolve, reject) => {
      const onExit = () => {
        this.pending.delete(id);
        reject(new Error(`server exited before response for ${method}`));
      };
      this.pending.set(id, { resolve, reject, onExit });
      this.child.once("exit", onExit);
      this.child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
      (
        this.child.stdin as typeof this.child.stdin & { flush?: () => void }
      ).flush?.();
    });
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
    );
    (
      this.child.stdin as typeof this.child.stdin & { flush?: () => void }
    ).flush?.();
  }

  async waitForExit(
    timeoutMs = 5_000,
  ): Promise<{ code: number | null; signal: string | null }> {
    if (this.exited)
      return { code: this.child.exitCode, signal: this.child.signalCode };
    return new Promise((resolve, reject) => {
      const onExit = (code: number | null, signal: string | null) => {
        cleanup();
        resolve({ code, signal });
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("child did not exit"));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.child.off("exit", onExit);
      };
      this.child.once("exit", onExit);
    });
  }

  finishAssertions(): void {
    expect(this.stdoutErrors).toEqual([]);
    expect(this.stdoutTail.trim()).toBe("");
    expect(this.stderr).not.toMatch(
      /MaxListenersExceededWarning|UnhandledPromiseRejection/,
    );
  }

  async stop(): Promise<void> {
    if (!this.exited) {
      this.child.kill("SIGTERM");
      await this.waitForExit().catch(() => undefined);
    }
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      this.child.off("exit", pending.onExit);
      pending.reject(new Error(`request ${String(id)} was abandoned`));
    }
  }
}

function launch(root: string, remoteUrl: string): StdioHarness {
  const harness = new StdioHarness(LOCAL_API_FAILURE, root, remoteUrl);
  children.push(harness);
  return harness;
}

async function initialize(child: StdioHarness): Promise<RpcFrame> {
  const response = await child.request(1, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "task-23-test", version: "1" },
  });
  child.notify("notifications/initialized");
  return response;
}

function callResult(response: RpcFrame): Record<string, unknown> {
  expect(response.jsonrpc).toBe("2.0");
  expect(response.error).toBeUndefined();
  expect(response.result).toBeDefined();
  return response.result as Record<string, unknown>;
}

function expectErrorResult(response: RpcFrame, text: string): void {
  const result = callResult(response);
  expect(result.isError).toBe(true);
  expect(result.content, JSON.stringify(result)).toEqual([
    { type: "text", text },
  ]);
}

describe("Task 23 unified stdio MCP server", { timeout: 15_000 }, () => {
  it("lists 43 tools, keeps stdout protocol-only, and handles 20 calls", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-mcp-ready-"));
    roots.push(root);
    const remote = await startRemoteMcpMock();
    try {
      const child = launch(root, remote.url);
      const initialized = await initialize(child);
      expect(initialized.result).toBeTruthy();
      const listed = await child.request(2, "tools/list");
      const tools = (callResult(listed).tools ?? []) as Array<
        Record<string, unknown>
      >;
      expect(tools).toHaveLength(43);
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          ...REMOTE_TOOL_NAMES,
          "browserlogin_session_start",
          "browserlogin_session_stop",
        ]),
      );

      let id = 3;
      const calls = [
        ["browserlogin_session_start", { profile_id: "profile-1" }],
        ["browserlogin_session_stop", { profile_id: "profile-1" }],
        ["browser_snapshot", { profile: "profile-1" }],
        ...REMOTE_TOOL_NAMES.map((remoteName) => [remoteName, {}]),
      ] as const;
      expect(calls).toHaveLength(20);

      expectErrorResult(
        await child.request(id++, "tools/call", {
          name: calls[0]![0],
          arguments: calls[0]![1],
        }),
        "Lifecycle request could not be completed.",
      );
      expectErrorResult(
        await child.request(id++, "tools/call", {
          name: calls[1]![0],
          arguments: calls[1]![1],
        }),
        "Lifecycle request could not be completed.",
      );
      expectErrorResult(
        await child.request(id++, "tools/call", {
          name: calls[2]![0],
          arguments: calls[2]![1],
        }),
        "PROFILE_NOT_RUNNING",
      );
      for (const [name, arguments_] of calls.slice(3)) {
        const response = await child.request(id++, "tools/call", {
          name,
          arguments: arguments_,
        });
        const result = callResult(response);
        expect(result.isError).toBe(false);
        expect(result.structuredContent).toEqual({
          result: { tool: name, ok: true },
        });
      }
      child.child.stdin.end();
      await child.waitForExit();
      child.finishAssertions();
    } finally {
      await remote.close();
    }
  });

  it("degrades to exactly 26 local tools within the discovery budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-mcp-degraded-"));
    roots.push(root);
    const child = launch(root, "http://127.0.0.1:1/mcp");
    const initialized = await initialize(child);
    expect(initialized.result).toBeTruthy();
    expect(
      (initialized.result as Record<string, unknown>).instructions,
    ).toContain("degraded local-only mode");
    const listed = await child.request(2, "tools/list");
    expect(callResult(listed).tools as unknown[]).toHaveLength(26);
    child.child.kill("SIGTERM");
    await child.waitForExit();
    child.finishAssertions();
  });

  it("prints the exact setup-required error and exits 2", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-mcp-empty-"));
    roots.push(root);
    const child = new StdioHarness(
      LOCAL_API_FAILURE,
      root,
      "http://127.0.0.1:1/mcp",
      "",
    );
    children.push(child);
    const result = await child.waitForExit();
    expect(result.code).toBe(2);
    expect(child.stderr).toBe("BrowserLogin connection setup is required\n");
    child.finishAssertions();
  });

  it("stops on SIGTERM within five seconds", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-mcp-sigterm-"));
    roots.push(root);
    const child = launch(root, "http://127.0.0.1:1/mcp");
    await initialize(child);
    child.child.kill("SIGTERM");
    const result = await child.waitForExit();
    expect(result.code).toBe(0);
    child.finishAssertions();
  });

  it("stops on stdin EOF within five seconds", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-mcp-eof-"));
    roots.push(root);
    const child = launch(root, "http://127.0.0.1:1/mcp");
    await initialize(child);
    child.child.stdin.end();
    const result = await child.waitForExit();
    expect(result.code).toBe(0);
    child.finishAssertions();
  });
});
