import type { CliGuideCommand } from "./types.js";

export const CLI_GUIDE_COMMANDS: readonly CliGuideCommand[] = [
  {
    command: "profiles",
    description:
      "List accessible profiles and their coarse session/archive state.",
  },
  {
    command: "start <profile_id>",
    description:
      "Start or recover a BrowserLogin profile session and local runner.",
  },
  {
    command: "stop <profile_id>",
    description: "Stop normally and preserve the verified browser archive.",
  },
  {
    command: "setup",
    description:
      "Save the BrowserLogin origin and API key through the OS keychain.",
  },
  {
    command: "status",
    description: "Print live-session, browser binary, and update state.",
  },
  {
    command: "binary download",
    description:
      "Download and verify the free browser build; add --pro for licensed builds.",
  },
  {
    command: "doctor",
    description:
      "Check connection setup, state path, relay port, and remote MCP derivation.",
  },
  {
    command: "mcp",
    description: "Start the unified stdio MCP server for an AI client.",
  },
  {
    command: "install-cli",
    description:
      "Install the current executable in the platform user CLI location.",
  },
] as const;
