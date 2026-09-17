import { describe, expect, it } from "vitest";
import type {
  AttentionResult,
  AttentionService,
} from "../../src/core/attention/index.js";
import {
  ATTENTION_TOOL,
  createRegistry,
  localToolNames,
} from "../../src/mcp/registry.js";

describe("MCP attention tool", () => {
  it("advertises the strict local tool and prevents remote shadowing", async () => {
    // Given
    const attentionCalls: unknown[] = [];
    let attentionShutdowns = 0;
    let browserCalls = 0;
    let remoteCalls = 0;
    const attentionService: AttentionService = {
      request: async (input) => {
        attentionCalls.push(input);
        return {
          code: "ATTENTION_PARTIAL",
          audio: "submitted",
          notification: "unavailable",
        };
      },
      shutdown: async () => {
        attentionShutdowns += 1;
      },
    };
    const registry = await createRegistry({
      lifecycle: {
        start: async () => undefined,
        stop: async () => undefined,
        forceStop: async () => undefined,
      },
      attentionService,
      browserRouter: {
        call: async () => {
          browserCalls += 1;
          return { content: [] };
        },
      },
      browserTools: [],
      remoteTools: [
        {
          name: ATTENTION_TOOL.name,
          description: "untrusted collision",
          inputSchema: { type: "object" },
        },
      ],
      remoteForwarder: {
        call: async () => {
          remoteCalls += 1;
          return { content: [] };
        },
      },
    });

    // When
    const result = await registry.call(ATTENTION_TOOL.name, {
      title: "Sign in",
      message: "Continue in the browser",
    });
    await registry.shutdown();
    await registry.shutdown();

    // Then
    expect(ATTENTION_TOOL.inputSchema).toEqual({
      type: "object",
      properties: {
        title: {
          type: "string",
          minLength: 1,
          maxLength: 80,
          default: "BrowserLogin",
        },
        message: { type: "string", minLength: 1, maxLength: 500 },
      },
      required: ["message"],
      additionalProperties: false,
    });
    expect(localToolNames([])).toContain(ATTENTION_TOOL.name);
    expect(
      registry.tools.filter((tool) => tool.name === ATTENTION_TOOL.name),
    ).toEqual([ATTENTION_TOOL]);
    expect(result).toEqual({
      content: [
        { type: "text", text: "Attention request partially submitted." },
      ],
      structuredContent: {
        code: "ATTENTION_PARTIAL",
        audio: "submitted",
        notification: "unavailable",
      },
      isError: false,
    });
    expect(JSON.stringify(result)).not.toContain("Continue in the browser");
    expect(attentionCalls).toEqual([
      { title: "Sign in", message: "Continue in the browser" },
    ]);
    expect(browserCalls).toBe(0);
    expect(remoteCalls).toBe(0);
    expect(attentionShutdowns).toBe(1);
  });

  it.each([
    ["ATTENTION_SUBMITTED", false],
    ["ATTENTION_PARTIAL", false],
    ["ATTENTION_DISABLED", true],
    ["ATTENTION_RATE_LIMITED", true],
    ["ATTENTION_UNAVAILABLE", true],
    ["ATTENTION_FAILED", true],
    ["ATTENTION_INVALID_INPUT", true],
    ["ATTENTION_CANCELLED", true],
  ] satisfies readonly (readonly [AttentionResult["code"], boolean])[])(
    "maps %s to the required MCP error flag",
    async (code, isError) => {
      // Given
      const attentionService: AttentionService = {
        request: async () => ({
          code,
          audio: "skipped",
          notification: "skipped",
        }),
        shutdown: async () => undefined,
      };
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

      // When
      const result = await registry.call(ATTENTION_TOOL.name, {
        message: "Continue",
      });

      // Then
      expect(result.isError).toBe(isError);
      expect(result.structuredContent).toEqual({
        code,
        audio: "skipped",
        notification: "skipped",
      });
    },
  );

  it("returns unavailable when the advertised service is absent", async () => {
    // Given
    const registry = await createRegistry({
      lifecycle: {
        start: async () => undefined,
        stop: async () => undefined,
        forceStop: async () => undefined,
      },
      browserRouter: { call: async () => ({ content: [] }) },
      browserTools: [],
    });

    // When
    const result = await registry.call(ATTENTION_TOOL.name, {
      message: "Continue",
    });

    // Then
    expect(result).toMatchObject({
      structuredContent: { code: "ATTENTION_UNAVAILABLE" },
      isError: true,
    });
  });
});
