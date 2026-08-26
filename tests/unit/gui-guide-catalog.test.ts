import { describe, expect, test } from "vitest";
import { SOURCE_MANIFEST_TOOL_NAMES } from "../../src/core/browser-tools/manifest.js";
import {
  CLI_GUIDE_COMMANDS,
  MCP_GUIDE_TOOL_GROUPS,
} from "../../src/mainview/guides/catalog.js";
import { GUIDE_ROUTES } from "../../src/mainview/guides/routes.js";

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

  test("documents every supported CLI command", () => {
    // Given
    const expectedCommands = [
      "profiles",
      "start <profile_id>",
      "stop <profile_id>",
      "setup",
      "status",
      "binary download",
      "doctor",
      "mcp",
      "install-cli",
    ];

    // When
    const commands = CLI_GUIDE_COMMANDS.map((command) => command.command);

    // Then
    expect(commands).toEqual(expectedCommands);
  });

  test("exposes both in-app guide routes in primary navigation", () => {
    // Given
    const expectedPaths = ["/guides/cli", "/guides/mcp"];

    // When
    const paths = GUIDE_ROUTES.map((route) => route.path);

    // Then
    expect(paths).toEqual(expectedPaths);
  });
});
