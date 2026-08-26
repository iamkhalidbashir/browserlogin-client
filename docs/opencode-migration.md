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
      "url": "https://example-1.app-csite-env.sapps.co/mcp/browserSessionMCP",
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

Prefer `browserlogin setup`, which stores the key through the OS keychain. Managed environments may provide a nonempty `BROWSERLOGIN_API_KEY`; optional overrides are the canonical application origin in `BROWSERLOGIN_BASE_URL` and `CLOAKBROWSER_LICENSE_KEY`. The client derives REST `/api/v1` and MCP `/mcp/browserSessionMCP` from that origin. Never commit these values.

## Compatibility

Remote tools are proxied without renaming and retain their input schemas. Successful discovery yields 45 tools by default. Remote failure yields 28 lifecycle/browser tools plus degraded-mode initialize instructions. Setting `BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE=1` adds the disabled-by-default RCE-equivalent browser-code tool, yielding 46 or 29 tools respectively. Stdout is JSON-RPC-only; diagnostics go to stderr/private logs.

Local lifecycle tools are advertised as `browser_session_start` and `browser_session_stop`. In OpenCode, the server namespace exposes them as `browserlogin_browser_session_start` and `browserlogin_browser_session_stop`. The v0.1.0 names `browserlogin_session_start` and `browserlogin_session_stop` are hidden from discovery but remain callable as local compatibility names for one release. They are reserved by the local registry and never forwarded to BrowserSessionMCP.

Browser installation is explicit. `browser_session_start` fails fast with an initialization-required error when no verified active runtime exists. Run `browser_init` with `source: "free"` or `source: "license"` and allow a long tool timeout; `browser_init_status` reports download progress and readiness. This prevents ordinary lifecycle calls from silently spending their timeout downloading a large browser archive.

Verify with:

```sh
bunx vitest run tests/integration/mcp-server.test.ts
```
