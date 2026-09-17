import { describe, expect, test } from "vitest";
import {
  AppRPCSchemas,
  type AppRPCMethod,
} from "../../src/shared/rpc-schema.js";
import { createRPCHandlers, type AppServices } from "../../src/bun/rpc.js";
import { createMockBridge, mockParams } from "../../src/mainview/mockBridge.js";

const methods = Object.keys(AppRPCSchemas) as AppRPCMethod[];

describe("complete RPC contract", () => {
  test("covers every registry method against mock and real Bun handlers", async () => {
    const covered = new Set<AppRPCMethod>();
    const bridge = createMockBridge();
    for (const method of methods) {
      const params = AppRPCSchemas[method].params.parse(mockParams[method]);
      const mock = await bridge.request(method, params);
      expect(mock.ok, `${method} mock`).toBe(true);
      if (!mock.ok) continue;
      const services = {
        [method]: async () => mock.value,
      } as AppServices;
      const handlers = createRPCHandlers({ services });
      const real = await handlers[method](params);
      expect(real.ok, `${method} real`).toBe(true);
      if (real.ok)
        expect(() =>
          AppRPCSchemas[method].result.parse(real.value),
        ).not.toThrow();
      covered.add(method);
    }
    expect([...covered].sort()).toEqual([...methods].sort());
  });

  test("intentional request and response drift fail with method context", async () => {
    expect(() =>
      createMockBridge({
        settingsGet: { update_channel: "unsupported" },
      }),
    ).toThrow();
    const handlers = createRPCHandlers({
      services: { profilesGet: async () => ({ id: "incomplete" }) },
    });
    await expect(
      handlers.profilesGet({ profileId: "profile-1" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RPC_ERROR" },
    });
  });

  test("round-trips simultaneous session transfer progress and idle state", async () => {
    // Given
    const snapshots = [
      {
        profileId: "profile-download",
        direction: "download",
        transferred: 40,
        total: 100,
        percentage: 40,
        status: "running",
      },
      {
        profileId: "profile-upload",
        direction: "upload",
        transferred: 100,
        total: 100,
        percentage: 100,
        status: "completed",
      },
    ] as const;
    const activeBridge = createMockBridge({
      sessionsTransferProgress: snapshots,
    });
    const idleBridge = createMockBridge({ sessionsTransferProgress: [] });

    // When
    const active = await activeBridge.request("sessionsTransferProgress", {});
    const idle = await idleBridge.request("sessionsTransferProgress", {});

    // Then
    expect(active).toEqual({ ok: true, value: snapshots });
    expect(idle).toEqual({ ok: true, value: [] });
    if (active.ok)
      expect(
        AppRPCSchemas.sessionsTransferProgress.result.parse(active.value),
      ).toEqual(snapshots);
  });
});
