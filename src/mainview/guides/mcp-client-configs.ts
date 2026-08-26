import type { McpClientConfig } from "./types.js";

export const MCP_CLIENT_CONFIGS: readonly McpClientConfig[] = [
  {
    name: "Standard stdio JSON",
    description:
      "Use this in Claude Desktop, Antigravity, Cursor, Gemini CLI, Junie, Kiro, and LM Studio under their mcpServers configuration.",
    snippets: [
      {
        label: "mcpServers",
        language: "json",
        code: `{
  "mcpServers": {
    "browserlogin": {
      "command": "browserlogin",
      "args": ["mcp"]
    }
  }
}`,
      },
    ],
  },
  {
    name: "Claude Code",
    description: "Add BrowserLogin through the Claude Code command line.",
    snippets: [
      {
        label: "Shell",
        language: "shell",
        code: "claude mcp add browserlogin browserlogin mcp",
      },
    ],
  },
  {
    name: "Codex",
    description:
      "Add with the Codex CLI or the mcp_servers section in ~/.codex/config.toml.",
    snippets: [
      {
        label: "Shell",
        language: "shell",
        code: "codex mcp add browserlogin -- browserlogin mcp",
      },
      {
        label: "~/.codex/config.toml",
        language: "toml",
        code: `[mcp_servers.browserlogin]
command = "browserlogin"
args = ["mcp"]`,
      },
    ],
  },
  {
    name: "GitHub Copilot CLI",
    description: "Add this local server to ~/.copilot/mcp-config.json.",
    snippets: [
      {
        label: "~/.copilot/mcp-config.json",
        language: "json",
        code: `{
  "mcpServers": {
    "browserlogin": {
      "type": "local",
      "command": "browserlogin",
      "tools": ["*"],
      "args": ["mcp"]
    }
  }
}`,
      },
    ],
  },
  {
    name: "VS Code with GitHub Copilot",
    description: "Install the server through the VS Code command line.",
    snippets: [
      {
        label: "Shell",
        language: "shell",
        code: `code --add-mcp '{"name":"browserlogin","command":"browserlogin","args":["mcp"]}'`,
      },
    ],
  },
  {
    name: "OpenCode",
    description:
      "Add this local server to ~/.config/opencode/opencode.json or a project opencode.json.",
    snippets: [
      {
        label: "opencode.json",
        language: "json",
        code: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "browserlogin": {
      "type": "local",
      "command": ["browserlogin", "mcp"],
      "enabled": true
    }
  }
}`,
      },
    ],
  },
  {
    name: "Cline",
    description: "Add this stdio server to cline_mcp_settings.json.",
    snippets: [
      {
        label: "cline_mcp_settings.json",
        language: "json",
        code: `{
  "mcpServers": {
    "browserlogin": {
      "type": "stdio",
      "command": "browserlogin",
      "args": ["mcp"],
      "disabled": false
    }
  }
}`,
      },
    ],
  },
  {
    name: "Amp",
    description: "Add BrowserLogin through the Amp CLI.",
    snippets: [
      {
        label: "Shell",
        language: "shell",
        code: "amp mcp add browserlogin -- browserlogin mcp",
      },
    ],
  },
  {
    name: "Factory Droid",
    description: "Add BrowserLogin through the Droid CLI.",
    snippets: [
      {
        label: "Shell",
        language: "shell",
        code: 'droid mcp add browserlogin "browserlogin mcp"',
      },
    ],
  },
  {
    name: "Grok",
    description:
      "Add with the Grok CLI or a Codex-style mcp_servers TOML entry.",
    snippets: [
      {
        label: "Shell",
        language: "shell",
        code: "grok mcp add browserlogin -- browserlogin mcp",
      },
      {
        label: "~/.grok/config.toml",
        language: "toml",
        code: `[mcp_servers.browserlogin]
command = "browserlogin"
args = ["mcp"]`,
      },
    ],
  },
  {
    name: "Goose, Qodo Gen, Warp, and Windsurf",
    description:
      "Create a local or stdio MCP server from the client settings and paste the Standard stdio JSON configuration above.",
    snippets: [],
  },
] as const;
