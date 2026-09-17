import { LOCAL_MCP_URL } from "../../shared/mcp-endpoints.js";
import type { McpClientConfig } from "./types.js";

export const CHATGPT_DESKTOP_CONFIG = {
  id: "chatgpt-desktop",
  name: "ChatGPT desktop",
  description:
    "Recommended for most people. The desktop app connects from this computer, so it can reach BrowserLogin on localhost.",
  transport: "streamable-http",
  steps: [
    "Install the ChatGPT desktop app on the same computer as BrowserLogin and sign in.",
    `Open Settings > MCP servers > Add server. Choose Streamable HTTP, name it BrowserLogin, and paste ${LOCAL_MCP_URL}.`,
    "Save, restart ChatGPT, then type /mcp in a chat to confirm the connection.",
  ],
  snippets: [],
} as const satisfies McpClientConfig;

export const MCP_DEVELOPER_CONFIGS = [
  {
    id: "cursor",
    name: "Cursor",
    description: "Add BrowserLogin through a global or project mcp.json file.",
    transport: "streamable-http",
    steps: [
      "Create ~/.cursor/mcp.json for all projects, or .cursor/mcp.json in one project.",
      "Add the configuration below and open Customize to confirm the server is enabled.",
    ],
    snippets: [
      {
        label: "mcp.json",
        language: "json",
        code: `{
  "mcpServers": {
    "browserlogin": {
      "url": "${LOCAL_MCP_URL}"
    }
  }
}`,
      },
    ],
  },
  {
    id: "vscode",
    name: "VS Code",
    description: "Add BrowserLogin to VS Code's MCP user configuration.",
    transport: "streamable-http",
    steps: [
      "Run MCP: Open User Configuration from the Command Palette.",
      "Add the configuration below, then run MCP: List Servers to confirm it connected.",
    ],
    snippets: [
      {
        label: "mcp.json",
        language: "json",
        code: `{
  "servers": {
    "browserlogin": {
      "type": "http",
      "url": "${LOCAL_MCP_URL}"
    }
  }
}`,
      },
    ],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    description:
      "Claude Code connects directly. Claude Desktop custom connectors are cloud-hosted and cannot reach this localhost URL.",
    transport: "streamable-http",
    steps: [
      "Run the command below from a terminal while BrowserLogin is open.",
      "Use /mcp inside Claude Code to inspect the connected tools.",
    ],
    snippets: [
      {
        label: "Terminal",
        language: "shell",
        code: `claude mcp add --transport http browserlogin ${LOCAL_MCP_URL}
claude mcp get browserlogin`,
      },
    ],
  },
  {
    id: "codex-cli",
    name: "Codex CLI",
    description:
      "Shares MCP configuration with ChatGPT desktop and the Codex IDE extension.",
    transport: "streamable-http",
    steps: [
      "Run the command below once to add BrowserLogin to your shared Codex configuration.",
      "Run codex mcp list, or type /mcp in Codex, to confirm it connected.",
    ],
    snippets: [
      {
        label: "Terminal",
        language: "shell",
        code: `codex mcp add browserlogin --url ${LOCAL_MCP_URL}
codex mcp list`,
      },
    ],
  },
  {
    id: "opencode",
    name: "OpenCode",
    description: "Add BrowserLogin as a remote MCP entry in opencode.json.",
    transport: "streamable-http",
    steps: [
      "Open your user or project opencode.json file.",
      "Add the configuration below, then restart OpenCode.",
    ],
    snippets: [
      {
        label: "opencode.json",
        language: "json",
        code: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "browserlogin": {
      "type": "remote",
      "url": "${LOCAL_MCP_URL}",
      "enabled": true
    }
  }
}`,
      },
    ],
  },
] as const satisfies readonly McpClientConfig[];

export const MCP_CLIENT_CONFIGS = [
  CHATGPT_DESKTOP_CONFIG,
  ...MCP_DEVELOPER_CONFIGS,
] as const satisfies readonly McpClientConfig[];
