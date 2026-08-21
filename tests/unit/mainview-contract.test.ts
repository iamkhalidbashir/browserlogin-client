import { describe, expect, test } from "vitest";
import {
  AppRPCSchemas,
  type AppRPCMethod,
} from "../../src/shared/rpc-schema.js";
import { createMockBridge, mockParams } from "../../src/mainview/mockBridge.js";

describe("Task 26 mock and real RPC contract", () => {
  test("every mock request and response passes the Task 25 zod schemas", async () => {
    const bridge = createMockBridge();
    for (const method of Object.keys(AppRPCSchemas) as AppRPCMethod[]) {
      const schema = AppRPCSchemas[method];
      const params = schema.params.parse(mockParams[method]);
      const response = await bridge.request(method, params);
      expect(response.ok, method).toBe(true);
      if (response.ok)
        expect(() => schema.result.parse(response.value)).not.toThrow();
    }
  });

  test("fails loudly when a mock response drifts", async () => {
    const bridge = createMockBridge({
      connectionGet: { appOrigin: "not-a-url", hasApiKey: true },
    });
    await expect(bridge.request("connectionGet", {})).rejects.toThrow();
  });
});
