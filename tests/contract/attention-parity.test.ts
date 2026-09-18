import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApplicationRuntime } from "../../src/core/app/index.js";
import { readAttentionSettings } from "../../src/core/app/settings.js";
import { createAttentionService } from "../../src/core/attention/index.js";
import { ConnectionStore } from "../../src/core/config/connection.js";
import { KeychainFacade } from "../../src/core/keychain/index.js";
import { createRPCHandlers } from "../../src/bun/rpc.js";
import { createRegistry } from "../../src/mcp/registry.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("attention settings parity", () => {
  test("applies GUI attention settings to subsequent MCP calls", async () => {
    // Given
    const root = await mkdtemp(
      join(tmpdir(), "browserlogin-attention-parity-"),
    );
    roots.push(root);
    const keychain = new KeychainFacade({
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
    });
    const application = createApplicationRuntime({
      root,
      connection: new ConnectionStore(root, keychain),
      keychain,
    });
    const rpc = createRPCHandlers({ services: application.services });
    const notify = vi.fn(async () => ({ status: "submitted" as const }));
    const playSound = vi.fn(async () => ({ status: "submitted" as const }));
    const attentionService = createAttentionService({
      readSettings: () => readAttentionSettings(root),
      adapter: { notify, playSound },
    });
    const registry = await createRegistry({
      lifecycle: {
        start: async () => undefined,
        stop: async () => undefined,
        forceStop: async () => undefined,
      },
      attentionService,
      browserRouter: { call: async () => ({ content: [] }) },
      browserTools: [],
    });

    try {
      // When
      const disabled = await registry.call("browserlogin_request_attention", {
        message: "Before opt-in",
      });
      await rpc.settingsSet({
        attentionEnabled: true,
        attentionDelivery: "notification",
        attentionSound: "subtle",
      });
      const enabled = await registry.call("browserlogin_request_attention", {
        message: "After opt-in",
      });

      // Then
      expect(disabled).toMatchObject({
        isError: true,
        structuredContent: { code: "ATTENTION_DISABLED" },
      });
      expect(enabled).toMatchObject({
        isError: false,
        structuredContent: {
          code: "ATTENTION_SUBMITTED",
          audio: "skipped",
          notification: "submitted",
        },
      });
      expect(notify).toHaveBeenCalledTimes(1);
      expect(playSound).not.toHaveBeenCalled();
    } finally {
      await registry.shutdown();
      await application.close();
    }
  });
});
