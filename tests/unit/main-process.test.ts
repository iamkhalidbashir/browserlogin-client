import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const electrobun = vi.hoisted(() => {
  let requests: Record<string, (params: unknown) => Promise<unknown>> = {};
  return {
    defineRPC: vi.fn(
      (options: {
        readonly handlers: {
          readonly requests: Record<
            string,
            (params: unknown) => Promise<unknown>
          >;
        };
      }) => {
        requests = options.handlers.requests;
        return {
          send: {
            binaryProgress: vi.fn(),
            updateStatus: vi.fn(),
          },
        };
      },
    ),
    request: (name: string) => requests[name],
    reset: () => {
      requests = {};
    },
  };
});

vi.mock("electrobun/main", () => ({
  BrowserView: { defineRPC: electrobun.defineRPC },
  BrowserWindow: class BrowserWindow {},
  Utils: {
    openExternal: vi.fn(() => true),
    quit: vi.fn(),
  },
}));

import { startMainProcess } from "../../src/bun/index.js";
import { installMainProcessShutdown } from "../../src/bun/shutdown.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  electrobun.reset();
  vi.clearAllMocks();
});

describe("desktop main-process lifecycle", () => {
  test("vetoes native quit until asynchronous owned-resource cleanup finishes", async () => {
    let beforeQuit!: (event: { response?: { allow: boolean } }) => void;
    const events = {
      on: vi.fn(
        (
          _name: "before-quit",
          handler: (event: { response?: { allow: boolean } }) => void,
        ) => {
          beforeQuit = handler;
        },
      ),
    };
    let releaseCleanup!: () => void;
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseCleanup = resolve;
        }),
    );
    const quit = vi.fn();
    installMainProcessShutdown({ stop }, events, quit);

    const initialQuit: { response?: { allow: boolean } } = {};
    beforeQuit(initialQuit);
    expect(initialQuit.response).toEqual({ allow: false });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();

    releaseCleanup();
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    const retriedQuit: { response?: { allow: boolean } } = {};
    beforeQuit(retriedQuit);
    expect(retriedQuit.response).toBeUndefined();
  });

  test("owns the local MCP server from startup through shutdown", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "browserlogin-main-process-"));
    roots.push(root);
    const events: string[] = [];
    const closeMcp = vi.fn(async () => {
      events.push("mcp-closed");
    });
    const startMcp = vi.fn(async () => ({
      url: "http://127.0.0.1:43110/mcp",
      close: closeMcp,
    }));

    // When
    const active = await startMainProcess({
      root,
      startMcp,
      createWindow: () => ({ test: true }),
      recover: async () => undefined,
      quit: async () => {
        events.push("quit");
      },
      checkUpdates: false,
    });
    await active.stop();

    // Then
    expect(startMcp).toHaveBeenCalledWith({ stateRoot: root });
    expect(closeMcp).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["mcp-closed", "quit"]);
  });

  test("restarts the local MCP server after connection setup", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "browserlogin-main-connect-"));
    roots.push(root);
    const events: string[] = [];
    let serverId = 0;
    const startMcp = vi.fn(async () => {
      serverId += 1;
      const activeId = serverId;
      return {
        url: "http://127.0.0.1:43110/mcp",
        close: async () => {
          events.push(`mcp-${activeId}-closed`);
        },
      };
    });
    const connectionSet = vi.fn(async () => ({
      appOrigin: "https://example.test",
      hasApiKey: true as const,
    }));
    const active = await startMainProcess({
      root,
      startMcp,
      services: { connectionSet },
      createWindow: () => ({ test: true }),
      recover: async () => undefined,
      quit: async () => undefined,
      checkUpdates: false,
    });

    try {
      // When
      const result = await electrobun.request("connectionSet")?.({
        appOrigin: "https://example.test",
        apiKey: "bl_test_key_secret",
      });

      // Then
      expect(result).toMatchObject({ ok: true });
      expect(connectionSet).toHaveBeenCalledTimes(1);
      expect(startMcp).toHaveBeenCalledTimes(2);
      expect(events).toEqual(["mcp-1-closed"]);
    } finally {
      await active.stop();
    }
    expect(events).toEqual(["mcp-1-closed", "mcp-2-closed"]);
  });

  test("restarts the local MCP server after connection clear", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "browserlogin-main-clear-"));
    roots.push(root);
    const events: string[] = [];
    let serverId = 0;
    const startMcp = vi.fn(async () => {
      serverId += 1;
      const activeId = serverId;
      return {
        url: "http://127.0.0.1:43110/mcp",
        close: async () => {
          events.push(`mcp-${activeId}-closed`);
        },
      };
    });
    const connectionClear = vi.fn(async () => ({ hasApiKey: false as const }));
    const active = await startMainProcess({
      root,
      startMcp,
      services: { connectionClear },
      createWindow: () => ({ test: true }),
      recover: async () => undefined,
      quit: async () => undefined,
      checkUpdates: false,
    });

    try {
      // When
      const result = await electrobun.request("connectionClear")?.({});

      // Then
      expect(result).toMatchObject({ ok: true });
      expect(connectionClear).toHaveBeenCalledTimes(1);
      expect(startMcp).toHaveBeenCalledTimes(2);
      expect(events).toEqual(["mcp-1-closed"]);
    } finally {
      await active.stop();
    }
    expect(events).toEqual(["mcp-1-closed", "mcp-2-closed"]);
  });

  test("serializes concurrent local MCP restarts", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-main-restarts-"));
    roots.push(root);
    let activeServers = 0;
    let maximumActiveServers = 0;
    const startMcp = vi.fn(async () => {
      activeServers += 1;
      maximumActiveServers = Math.max(maximumActiveServers, activeServers);
      let closed = false;
      return {
        url: "http://127.0.0.1:43110/mcp",
        close: async () => {
          if (closed) return;
          closed = true;
          activeServers -= 1;
        },
      };
    });
    const connectionSet = vi.fn(async () => ({
      appOrigin: "https://example.test",
      hasApiKey: true as const,
    }));
    const active = await startMainProcess({
      root,
      startMcp,
      services: { connectionSet },
      createWindow: () => ({ test: true }),
      recover: async () => undefined,
      quit: async () => undefined,
      checkUpdates: false,
    });

    try {
      await Promise.all([
        electrobun.request("connectionSet")?.({
          appOrigin: "https://example.test",
          apiKey: "bl_test_key_secret",
        }),
        electrobun.request("connectionSet")?.({
          appOrigin: "https://example.test",
          apiKey: "bl_test_key_secret",
        }),
      ]);
      expect(startMcp).toHaveBeenCalledTimes(3);
      expect(maximumActiveServers).toBe(1);
    } finally {
      await active.stop();
    }
    expect(activeServers).toBe(0);
  });

  test("closes an MCP server that finishes starting during shutdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-main-stop-race-"));
    roots.push(root);
    const closeInitial = vi.fn(async () => undefined);
    const closeRestarted = vi.fn(async () => undefined);
    let resolveRestart!: (server: {
      url: string;
      close: () => Promise<void>;
    }) => void;
    const restarted = new Promise<{
      url: string;
      close: () => Promise<void>;
    }>((resolve) => {
      resolveRestart = resolve;
    });
    const startMcp = vi
      .fn()
      .mockResolvedValueOnce({
        url: "http://127.0.0.1:43110/mcp",
        close: closeInitial,
      })
      .mockImplementationOnce(async () => restarted);
    const connectionSet = vi.fn(async () => ({
      appOrigin: "https://example.test",
      hasApiKey: true as const,
    }));
    const active = await startMainProcess({
      root,
      startMcp,
      services: { connectionSet },
      createWindow: () => ({ test: true }),
      recover: async () => undefined,
      quit: async () => undefined,
      checkUpdates: false,
    });
    const changing = electrobun.request("connectionSet")?.({
      appOrigin: "https://example.test",
      apiKey: "bl_test_key_secret",
    });
    await vi.waitFor(() => expect(startMcp).toHaveBeenCalledTimes(2));

    const stopping = active.stop();
    resolveRestart({
      url: "http://127.0.0.1:43110/mcp",
      close: closeRestarted,
    });
    await Promise.all([changing, stopping]);

    expect(closeInitial).toHaveBeenCalledTimes(1);
    expect(closeRestarted).toHaveBeenCalledTimes(1);
  });

  test("releases the local MCP server when desktop startup fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-main-failure-"));
    roots.push(root);
    const closeMcp = vi.fn(async () => undefined);

    await expect(
      startMainProcess({
        root,
        startMcp: async () => ({
          url: "http://127.0.0.1:43110/mcp",
          close: closeMcp,
        }),
        createWindow: () => {
          throw new Error("window startup failed");
        },
        recover: async () => undefined,
        checkUpdates: false,
      }),
    ).rejects.toThrow("window startup failed");
    expect(closeMcp).toHaveBeenCalledTimes(1);
  });
});
