import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { REMOTE_TOOL_NAMES } from "../mocks/remote-mcp-server.js";
import { startRemoteMcpMock } from "../mocks/remote-mcp-server.js";

const BUN = `${process.env.HOME ?? "/Users/bashir"}/.bun/bin/bun`;
const SERVER = join(process.cwd(), "src/mcp/server.ts");
const API_KEY = "bl_test_key_secret";
const children: ChildProcessWithoutNullStreams[] = [];
const roots: string[] = [];
const stderrByChild = new WeakMap<ChildProcessWithoutNullStreams, string>();

afterEach(async () => {
  await Promise.all(
    children.splice(0).map(async (child) => {
      if (!child.killed && child.exitCode === null) child.kill("SIGTERM");
      if (child.exitCode === null)
        await once(child, "exit").catch(() => undefined);
    }),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function launch(
  root: string,
  remoteUrl: string,
): ChildProcessWithoutNullStreams {
  const child = spawn(BUN, [SERVER], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BROWSERLOGIN_STATE_DIR: root,
      BROWSERLOGIN_API_KEY: API_KEY,
      BROWSERLOGIN_MCP_REMOTE_TOKEN: API_KEY,
      BROWSERLOGIN_MCP_REMOTE_URL: remoteUrl,
    },
    stdio: "pipe",
  });
  child.stderr.setEncoding("utf8");
  stderrByChild.set(child, "");
  child.stderr.on("data", (chunk: string) =>
    stderrByChild.set(child, `${stderrByChild.get(child) ?? ""}${chunk}`),
  );
  children.push(child);
  return child;
}

async function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = 5_000,
): Promise<{ code: number | null; stderr: string }> {
  let stderr = "";
  const onStderr = (chunk: string) => {
    stderr += chunk;
  };
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", onStderr);
  const exit = (
    child.exitCode !== null
      ? Promise.resolve([child.exitCode, null])
      : once(child, "exit")
  ).then(([code]) => {
    child.stderr.off("data", onStderr);
    return {
      code: code as number | null,
      stderr: `${stderrByChild.get(child) ?? ""}${stderr}`,
    };
  });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("child did not exit")), timeoutMs),
  );
  return Promise.race([exit, timeout]);
}

async function request(
  child: ChildProcessWithoutNullStreams,
  id: number,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  let buffer = "";
  const result = new Promise<Record<string, unknown>>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch (error) {
          reject(new Error(`invalid stdout frame: ${line}: ${String(error)}`));
          return;
        }
        if (
          !parsed ||
          typeof parsed !== "object" ||
          (parsed as Record<string, unknown>).jsonrpc !== "2.0"
        ) {
          reject(new Error(`invalid JSON-RPC frame: ${line}`));
          return;
        }
        if ((parsed as Record<string, unknown>).id === id) {
          child.stdout.off("data", onData);
          resolve(parsed as Record<string, unknown>);
        }
      }
    };
    child.stdout.on("data", onData);
    child.once("exit", (code, signal) =>
      reject(
        new Error(
          `server exited before response (${String(code)}, ${String(signal)}): ${stderrByChild.get(child) ?? ""}`,
        ),
      ),
    );
  });
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
  );
  (child.stdin as typeof child.stdin & { flush?: () => void }).flush?.();
  return result;
}

async function initialize(
  child: ChildProcessWithoutNullStreams,
): Promise<Record<string, unknown>> {
  return request(child, 1, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "task-23-test", version: "1" },
  });
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
      const listed = await request(child, 2, "tools/list");
      const tools = (listed.result as Record<string, unknown>).tools as Array<
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
      expect(calls.length).toBeGreaterThanOrEqual(20);
      for (const [name, args] of calls) {
        const response = await request(child, id++, "tools/call", {
          name,
          ...args,
        });
        expect(response.jsonrpc).toBe("2.0");
        expect(response.result ?? response.error).toBeTruthy();
      }
      child.stdin.end();
      await waitForExit(child);
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
    const listed = await request(child, 2, "tools/list");
    const tools = (listed.result as Record<string, unknown>).tools as unknown[];
    expect(tools).toHaveLength(26);
    const instructions = (initialized.result as Record<string, unknown>)
      .instructions as string;
    expect(instructions).toContain("degraded local-only mode");
    child.kill("SIGTERM");
    await waitForExit(child);
  });

  it("prints the exact setup-required error and exits 2", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-mcp-empty-"));
    roots.push(root);
    const child = spawn(BUN, [SERVER], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BROWSERLOGIN_STATE_DIR: root,
        BROWSERLOGIN_API_KEY: "",
        BROWSERLOGIN_MCP_REMOTE_URL: "http://127.0.0.1:1/mcp",
      },
      stdio: "pipe",
    });
    children.push(child);
    const result = await waitForExit(child);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe("BrowserLogin connection setup is required\n");
  });

  it("stops on SIGTERM within five seconds", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-mcp-sigterm-"));
    roots.push(root);
    const child = launch(root, "http://127.0.0.1:1/mcp");
    await initialize(child);
    child.kill("SIGTERM");
    const result = await waitForExit(child);
    expect(result.code).toBe(0);
  });

  it("stops on stdin EOF within five seconds", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-mcp-eof-"));
    roots.push(root);
    const child = launch(root, "http://127.0.0.1:1/mcp");
    await initialize(child);
    child.stdin.end();
    const result = await waitForExit(child);
    expect(result.code).toBe(0);
  });
});
