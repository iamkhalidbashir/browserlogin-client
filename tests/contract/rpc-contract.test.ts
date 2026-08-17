import { describe, expect, test } from "vitest";
import {
  AppRPCSchemas,
  type AppRPCMethod,
} from "../../src/shared/rpc-schema.js";
import { createRPCHandlers, type AppServices } from "../../src/bun/rpc.js";
import { createMockBridge, mockParams } from "../../src/mainview/mockBridge.js";

const methods = Object.keys(AppRPCSchemas) as AppRPCMethod[];

describe("Task 30 complete RPC contract", () => {
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
    const bridge = createMockBridge({
      settingsGet: { update_channel: "unsupported" },
    });
    await expect(bridge.request("settingsGet", {})).rejects.toThrow();
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
});
