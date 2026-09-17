import { describe, expect, it } from "vitest";
import { BrowserInitializationRequiredError } from "../../src/core/binary/index.js";
import {
  BROWSER_INIT_STATUS_TOOL,
  BROWSER_INIT_TOOL,
  createRegistry,
  STOP_TOOL,
} from "../../src/mcp/registry.js";

describe("local MCP registry", () => {
  it("reports initialization requirements and routes explicit browser initialization", async () => {
    const calls: string[] = [];
    const registry = await createRegistry({
      lifecycle: {
        start: async () => {
          throw new BrowserInitializationRequiredError();
        },
        stop: async () => undefined,
        forceStop: async () => undefined,
      },
      binaryInitialization: {
        initialize: async (source) => {
          calls.push(`init:${source}`);
          return {
            state: "ready" as const,
            downloaded: 10,
            total: 10,
            binary: {
              path: "/tmp/cloakbrowser",
              version: undefined,
              platform: undefined,
              pro: source === "license",
              sha256: undefined,
              binarySha256: undefined,
              source: "official" as const,
              trust: "verified" as const,
            },
          };
        },
        status: async () => ({
          state: "not-installed" as const,
          downloaded: 0,
          total: null,
          binary: null,
        }),
      },
      browserRouter: { call: async () => ({ content: [] }) },
      browserTools: [],
    });

    expect(BROWSER_INIT_TOOL.inputSchema.properties).toHaveProperty("source");
    expect(BROWSER_INIT_STATUS_TOOL.inputSchema.required).toEqual([]);
    await expect(
      registry.call("browser_session_start", { profile_id: "profile-init" }),
    ).resolves.toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "CloakBrowser is not initialized. Call browser_init, then retry browser_session_start.",
        },
      ],
    });
    await expect(
      registry.call("browser_init", { source: "free" }),
    ).resolves.not.toMatchObject({ isError: true });
    await expect(
      registry.call("browser_init_status", {}),
    ).resolves.not.toMatchObject({ isError: true });
    expect(calls).toEqual(["init:free"]);
    await registry.shutdown();
  });

  it("routes force session stop without invoking normal stop", async () => {
    const calls: string[] = [];
    const registry = await createRegistry({
      lifecycle: {
        start: async () => undefined,
        stop: async (profileId) => calls.push(`stop:${profileId}`),
        forceStop: async (profileId) => calls.push(`force:${profileId}`),
      },
      browserRouter: { call: async () => ({ content: [] }) },
      browserLifecycle: {
        stop: async (profileId) => calls.push(`browser-stop:${profileId}`),
        forceStop: async (profileId) =>
          calls.push(`browser-force:${profileId}`),
        shutdown: async () => undefined,
      },
      browserTools: [],
    });

    expect(STOP_TOOL.inputSchema.properties).toHaveProperty("force", {
      type: "boolean",
    });
    await expect(
      registry.call("browser_session_stop", {
        profile_id: "profile-force",
        force: true,
      }),
    ).resolves.not.toMatchObject({ isError: true });
    expect(calls).toEqual(["browser-force:profile-force"]);
    await registry.shutdown();
  });
});
