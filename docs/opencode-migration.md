# Migrating OpenCode to the unified BrowserLogin MCP server

BrowserLogin Client replaces the legacy local Python lifecycle server and separate remote BrowserSessionMCP entry with one local stdio process. Back up `~/.config/opencode/opencode.jsonc` first.

## Before

The current legacy entries have this exact structure; secrets are redacted:

```jsonc
{
  "mcp": {
    "bl_client": {
      "type": "local",
      "command": [
        "uv",
        "run",
        "--project",
        "/Users/bashir/Projects/OpensourceProjects/cloakbrowser-pro/browserlogin-client",
        "browserlogin-client-mcp",
      ],
      "cwd": "/Users/bashir/Projects/OpensourceProjects/cloakbrowser-pro/browserlogin-client",
      "enabled": false,
      "environment": {
        "BROWSERLOGIN_API_KEY": "<redacted>",
      },
    },
    "browserSessionMCP": {
      "enabled": false,
      "type": "remote",
      "url": "https://noble-spark-8295-06576bc2.app-csite-env.sapps.co/mcp/browserSessionMCP",
      "headers": {
        "Authorization": "<redacted>",
      },
    },
  },
}
```

## After

Remove both entries and add:

```jsonc
{
  "mcp": {
    "browserlogin": {
      "type": "local",
      "command": ["browserlogin", "mcp"],
      "enabled": true,
    },
  },
}
```

`browserlogin` must be on OpenCode's `PATH`. `browserlogin install-cli` prints the installed path and fragment.

## Overrides

Prefer `browserlogin setup`, which stores the key through the OS keychain. Managed environments may provide a nonempty `BROWSERLOGIN_API_KEY`; optional overrides are `BROWSERLOGIN_BASE_URL`, `CLOAKBROWSER_LICENSE_KEY`, `BROWSERLOGIN_MCP_REMOTE_URL`, and `BROWSERLOGIN_MCP_REMOTE_TOKEN`. Never commit these values.

## Compatibility

Remote tools are proxied without renaming and retain their input schemas. Successful discovery yields 43 tools. Remote failure yields 26 lifecycle/browser tools plus degraded-mode initialize instructions. Stdout is JSON-RPC-only; diagnostics go to stderr/private logs.

Verify with:

```sh
bunx vitest run tests/integration/mcp-server.test.ts
```
