# BrowserLogin MCP

BrowserLogin serves one merged MCP registry through either the app-owned HTTP endpoint or the standalone stdio command. The HTTP endpoint starts with local tools before Connection setup and adds hosted workspace tools after setup, without requiring a second MCP connection.

| Connection                    | Address or command                                                               | Safe-default tools                                       | Authentication                                 |
| ----------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| App-owned HTTP                | `http://127.0.0.1:43110/mcp`                                                     | 28 local tools before setup; 45 merged tools after setup | Managed by the app; no MCP header              |
| Standalone stdio              | `browserlogin mcp`                                                               | 45 merged tools after CLI setup                          | CLI keychain or environment setup              |
| Optional hosted-only fallback | `https://noble-spark-8295-06576bc2.app-csite-env.sapps.co/mcp/browserSessionMCP` | 17 workspace tools; no local browser control             | `Authorization: Bearer <BROWSERLOGIN_API_KEY>` |

Use one of the first two connections for the complete BrowserLogin tool set. Use the public URL only when a client cannot reach localhost and needs hosted workspace operations without local browser control.

## Local Setup

1. Install and open the BrowserLogin desktop app.
2. Configure the AI client to use `http://127.0.0.1:43110/mcp`. The endpoint immediately exposes 28 local lifecycle and browser tools.
3. Complete Connection setup in the app to add 17 hosted workspace tools. BrowserLogin stores the API key through the operating-system keychain backend and refreshes the endpoint automatically.
4. Keep the app open while the AI client uses the endpoint.

The local server binds only to `127.0.0.1`, validates the HTTP `Host` header, starts with the app, and closes before the app exits. The app supplies hosted credentials internally, so the MCP client never needs a second endpoint or authorization header.

Only one BrowserLogin instance can own the fixed local port. If the endpoint is unavailable, confirm that the app is running and that another process is not using port `43110`.

## Standalone Stdio Setup

Use this mode when a terminal or AI client must work without the desktop app:

1. Download the platform's `browserlogin-<version>-<platform>` executable and matching `browserlogin-browser-tools-<platform>` helper from the same release.
2. Keep both executable files in the same directory.
3. Run `browserlogin setup`, or provide `BROWSERLOGIN_API_KEY` and optional connection overrides to the process.
4. Configure the AI client to launch `browserlogin mcp` over stdio.

The stdio process owns its local browser runtime and exposes the same 45 safe-default local and workspace tools as the connected app-owned endpoint. Standard output is reserved for JSON-RPC traffic.

## Optional Hosted-Only Fallback

Use this endpoint only when the AI client cannot reach localhost and does not need local browser control. It is not a required second connection.

Connect directly to:

```text
https://noble-spark-8295-06576bc2.app-csite-env.sapps.co/mcp/browserSessionMCP
```

Send the API key on every request:

```text
Authorization: Bearer <BROWSERLOGIN_API_KEY>
```

Use the AI client's secret or environment mechanism when possible. Never commit the key in a project configuration.

## Client Configuration

Configure one BrowserLogin connection: app-owned HTTP for desktop use, or standalone stdio for terminal-only use.

### OpenCode

Add the app-owned HTTP endpoint to the user or project `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "browserlogin-local": {
      "type": "remote",
      "url": "http://127.0.0.1:43110/mcp",
      "enabled": true
    }
  }
}
```

For terminal-only operation, replace that entry with the stdio command:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "browserlogin-stdio": {
      "type": "local",
      "command": ["browserlogin", "mcp"],
      "enabled": true
    }
  }
}
```

### Other MCP Clients

MCP configuration file shapes differ by client. Use one of these transport values:

- Desktop app: Streamable HTTP or remote HTTP at `http://127.0.0.1:43110/mcp`, with no headers.
- Standalone CLI: local stdio process command `browserlogin mcp` after `browserlogin setup`.
- Hosted-only fallback: remote HTTP at `https://noble-spark-8295-06576bc2.app-csite-env.sapps.co/mcp/browserSessionMCP`, with the bearer header above. This connection has no local tools.

## First Browser Workflow

1. Call local `browser_init` with `source: "free"` if CloakBrowser is not installed. Use `browser_init_status` to monitor the download.
2. Call local `browser_session_start` with the BrowserLogin `profile_id`.
3. Call browser tools with the same `profile` identifier. Browser tools only operate on a running session.
4. End normally with local `browser_session_stop` to preserve and upload the profile archive. Use `force: true` only when discarding local changes is acceptable.

`browser_close` also performs the normal BrowserLogin stop workflow for its required `profile`.

## Merged Tool Catalog

The app-owned HTTP endpoint exposes the local catalog immediately. After Connection setup, both primary connection modes expose the local and hosted catalogs together through one registry.

### Local Tools

The safe-default local catalog contains four lifecycle/bootstrap tools and 24 browser tools.

#### Lifecycle And Bootstrap

| Tool                    | Purpose                                                | Required arguments                            |
| ----------------------- | ------------------------------------------------------ | --------------------------------------------- |
| `browser_init`          | Download, verify, and install CloakBrowser.            | None; optional `source`: `free` or `license`. |
| `browser_init_status`   | Report browser download/install progress.              | None.                                         |
| `browser_session_start` | Start the local BrowserLogin lifecycle for a profile.  | `profile_id`                                  |
| `browser_session_stop`  | Stop and commit an archive, or force-stop without one. | `profile_id`; optional `force`.               |

#### Browser Automation

Every browser tool requires a running session and a nonempty `profile`. Use `browser_snapshot` to obtain current element references before acting.

| Tool                       | Purpose                                            |
| -------------------------- | -------------------------------------------------- |
| `browser_close`            | Stop the BrowserLogin session and browser runtime. |
| `browser_resize`           | Resize the browser window.                         |
| `browser_console_messages` | Read browser console messages.                     |
| `browser_handle_dialog`    | Accept or dismiss a JavaScript dialog.             |
| `browser_evaluate`         | Evaluate a page or element expression.             |
| `browser_file_upload`      | Upload files or cancel a file chooser.             |
| `browser_drop`             | Drop files or MIME data onto an element.           |
| `browser_find`             | Find text or a regular expression in a snapshot.   |
| `browser_fill_form`        | Fill multiple fields with humanized input.         |
| `browser_press_key`        | Press a key or generate a character.               |
| `browser_type`             | Type text with humanized input.                    |
| `browser_navigate`         | Navigate the current tab to a URL.                 |
| `browser_navigate_back`    | Return to the previous history entry.              |
| `browser_network_requests` | List requests made by the current page.            |
| `browser_network_request`  | Inspect one request and response.                  |
| `browser_take_screenshot`  | Save a page or element screenshot.                 |
| `browser_snapshot`         | Capture an accessibility snapshot and references.  |
| `browser_click`            | Click an element.                                  |
| `browser_drag`             | Drag between elements.                             |
| `browser_hover`            | Hover an element.                                  |
| `browser_select_option`    | Select a dropdown option.                          |
| `browser_tabs`             | List, create, close, or select tabs.               |
| `browser_wait_for`         | Wait for text, disappearing text, or time.         |
| `browser_modal_watch`      | Handle the next upload prompt or dialog.           |

#### Unsafe Browser Code

`browser_run_code_unsafe` runs arbitrary Playwright JavaScript and is RCE-equivalent. It is not advertised unless the BrowserLogin process starts with `BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE=1`. Enabling it raises the local catalog from 28 to 29 tools and the merged catalog from 45 to 46 tools. Leave it disabled unless arbitrary code execution is explicitly required and trusted.

### Hosted Workspace Tools

After setup, the primary HTTP and stdio connections add these 17 BrowserLogin workspace tools to the local catalog. The optional public fallback exposes only these tools; it does not expose session lifecycle, archive transfer, or browser automation.

| Area     | Tools                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------- |
| Profiles | `profiles_list`, `profile_get`, `profile_create`, `profile_update`, `profile_delete`, `profile_restore` |
| Notes    | `notes_get`, `notes_append`, `notes_update`                                                             |
| Proxies  | `proxies_list`, `proxy_change_ip`                                                                       |
| Members  | `members_list`, `member_share`, `member_remove`                                                         |
| Users    | `users_list`, `user_disable`                                                                            |
| Audit    | `audit_list`                                                                                            |

Workspace tools retain their hosted schemas and redact proxy credentials. See the [API guide](api.md#mcp-contract) for the hosted transport and authorization contract.

## Troubleshooting

- Local endpoint refuses the connection: open BrowserLogin and confirm port `43110` is free.
- Stdio client cannot find `browserlogin`: install the standalone CLI/helper pair and confirm the CLI directory is on that client's inherited `PATH`.
- Local endpoint still lists only 28 tools after Connection setup: confirm the app reports a saved connection, then reconnect so the app refreshes its owned MCP server.
- `CloakBrowser is not initialized`: call local `browser_init`, wait for `browser_init_status` to report `ready`, and retry.
- `PROFILE_NOT_RUNNING`: call local `browser_session_start` first and pass the same profile ID as `profile`.
- Hosted-only fallback returns `401`: verify the exact `Authorization: Bearer ...` header and that the API key is active.
- Browser tools are missing from the hosted-only fallback: use the local HTTP or stdio connection; the fallback intentionally serves workspace tools only.
