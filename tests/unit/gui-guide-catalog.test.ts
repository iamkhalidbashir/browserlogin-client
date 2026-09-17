import { describe, expect, test } from "vitest";
import { SOURCE_MANIFEST_TOOL_NAMES } from "../../src/core/browser-tools/manifest.js";
import {
  CHATGPT_DESKTOP_CONFIG,
  MCP_CLIENT_CONFIGS,
  MCP_DEVELOPER_CONFIGS,
  MCP_GUIDE_TOOL_GROUPS,
  MCP_PLATFORM_SETUPS,
} from "../../src/mainview/guides/catalog.js";
import { GUIDE_ROUTES } from "../../src/mainview/guides/routes.js";
import {
  LOCAL_MCP_URL,
  PUBLIC_MCP_URL,
} from "../../src/shared/mcp-endpoints.js";

describe("in-app guide catalog", () => {
  test("documents the complete AI tool catalog without duplicate tool names", () => {
    // Given
    const expectedToolCounts = [4, 24, 1, 17];

    // When
    const tools = MCP_GUIDE_TOOL_GROUPS.flatMap((group) => group.tools);

    // Then
    expect(MCP_GUIDE_TOOL_GROUPS.map((group) => group.tools.length)).toEqual(
      expectedToolCounts,
    );
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(46);
  });

  test("matches the source browser manifest", () => {
    // Given
    const expectedBrowserTools = [
      ...SOURCE_MANIFEST_TOOL_NAMES,
      "browser_modal_watch",
    ].sort();

    // When
    const documentedBrowserTools = MCP_GUIDE_TOOL_GROUPS.slice(1, 3)
      .flatMap((group) => group.tools)
      .map((tool) => tool.name)
      .sort();

    // Then
    expect(documentedBrowserTools).toEqual(expectedBrowserTools);
  });

  test("exposes MCP as the only in-app guide route", () => {
    // Given
    const expectedPaths = ["/guides/mcp"];

    // When
    const paths = GUIDE_ROUTES.map((route) => route.path);

    // Then
    expect(paths).toEqual(expectedPaths);
  });

  test("provides a local-first client matrix with ChatGPT desktop first", () => {
    // Given
    const expectedClientIds = [
      "chatgpt-desktop",
      "cursor",
      "vscode",
      "claude-code",
      "codex-cli",
      "opencode",
    ];

    // When
    const clientIds = MCP_CLIENT_CONFIGS.map((client) => client.id);
    const serialized = JSON.stringify(MCP_CLIENT_CONFIGS);

    // Then
    expect(clientIds).toEqual(expectedClientIds);
    expect(CHATGPT_DESKTOP_CONFIG.id).toBe("chatgpt-desktop");
    expect(MCP_DEVELOPER_CONFIGS.map((client) => client.id)).toEqual(
      expectedClientIds.slice(1),
    );
    expect(
      MCP_CLIENT_CONFIGS.every(
        (client) => client.transport === "streamable-http",
      ),
    ).toBe(true);
    expect(serialized).toContain(LOCAL_MCP_URL);
    expect(serialized).not.toContain(PUBLIC_MCP_URL);
    expect(serialized).not.toContain('"command"');
  });

  test("covers every supported desktop operating system", () => {
    // Given
    const expectedPlatforms = ["macos", "windows", "linux"];

    // When
    const platforms = MCP_PLATFORM_SETUPS.map((setup) => setup.id);

    // Then
    expect(platforms).toEqual(expectedPlatforms);
    expect(MCP_PLATFORM_SETUPS.every((setup) => setup.steps.length > 0)).toBe(
      true,
    );
  });
});
