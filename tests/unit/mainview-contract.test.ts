import { describe, expect, test } from "vitest";
import {
  AppRPCSchemas,
  type AppRPCMethod,
} from "../../src/shared/rpc-schema.js";
import { createMockBridge, mockParams } from "../../src/mainview/mockBridge.js";

describe("mock and real RPC contract", () => {
  test("every mock request and response passes the application Zod schemas", async () => {
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

  test("provides safe agent attention defaults from mock settings", async () => {
    // Given
    const bridge = createMockBridge();

    // When
    const loaded = await bridge.request("settingsGet", {});

    // Then
    expect(loaded).toMatchObject({
      ok: true,
      value: {
        attention_enabled: false,
        attention_delivery: "both",
        attention_sound: "default",
      },
    });
  });

  test("persists all agent attention preferences in the mock settings contract", async () => {
    // Given
    const bridge = createMockBridge();

    // When
    const saved = await bridge.request("settingsSet", {
      attentionEnabled: true,
      attentionDelivery: "audio",
      attentionSound: "urgent",
    });
    const loaded = await bridge.request("settingsGet", {});

    // Then
    expect(saved).toMatchObject({
      ok: true,
      value: {
        attention_enabled: true,
        attention_delivery: "audio",
        attention_sound: "urgent",
      },
    });
    expect(loaded).toMatchObject({
      ok: true,
      value: {
        attention_enabled: true,
        attention_delivery: "audio",
        attention_sound: "urgent",
      },
    });
  });

  test("replaces seeded settings overrides with later saved attention preferences", async () => {
    // Given
    const bridge = createMockBridge({
      settingsGet: {
        attention_enabled: true,
        attention_delivery: "audio",
        attention_sound: "urgent",
      },
    });
    const seeded = await bridge.request("settingsGet", {});
    expect(seeded).toMatchObject({
      ok: true,
      value: {
        attention_enabled: true,
        attention_delivery: "audio",
        attention_sound: "urgent",
      },
    });

    // When
    await bridge.request("settingsSet", {
      attentionEnabled: false,
      attentionDelivery: "both",
      attentionSound: "subtle",
    });
    const loaded = await bridge.request("settingsGet", {});

    // Then
    expect(loaded).toMatchObject({
      ok: true,
      value: {
        attention_enabled: false,
        attention_delivery: "both",
        attention_sound: "subtle",
      },
    });
  });
});
