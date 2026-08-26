import {
  BROWSER_TOOLS,
  LIFECYCLE_TOOLS,
  UNSAFE_BROWSER_TOOLS,
} from "./mcp-browser-tools.js";
import { REMOTE_MCP_TOOLS } from "./mcp-remote-tools.js";
import type { GuideToolGroup } from "./types.js";

export const MCP_GUIDE_TOOL_GROUPS: readonly GuideToolGroup[] = [
  {
    name: "Lifecycle and bootstrap (4)",
    description:
      "Install the browser runtime, then start and stop profile sessions.",
    tools: LIFECYCLE_TOOLS,
  },
  {
    name: "Browser automation (24)",
    description:
      "Every tool requires a running BrowserLogin session and its profile ID.",
    tools: BROWSER_TOOLS,
  },
  {
    name: "Unsafe browser code (1, opt-in)",
    description:
      "This tool is hidden unless BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE=1 is set for the MCP server process.",
    tools: UNSAFE_BROWSER_TOOLS,
  },
  {
    name: "Remote BrowserLogin workspace tools (17)",
    description:
      "These tools are available after remote MCP discovery and always redact proxy credentials.",
    tools: REMOTE_MCP_TOOLS,
  },
] as const;
