# BrowserLogin MCP guide

BrowserLogin exposes one local stdio MCP server. It combines the local browser-session lifecycle, profile-scoped browser automation, and the remote BrowserLogin workspace tools in a single connection.

Use the local server instead of adding the remote BrowserSessionMCP endpoint directly. The client derives the remote endpoint from the BrowserLogin application origin, keeps the API key in the operating-system keychain when possible, and exposes a useful local-only catalog if the remote service is temporarily unavailable.

## Before connecting

1. Install the compiled `browserlogin` CLI and the matching `browserlogin-browser-tools-<platform>` helper from [GitHub Releases](https://github.com/iamkhalidbashir/browserlogin-client/releases). Keep the helper next to the CLI under its release filename and put `browserlogin` on the `PATH` of the AI client.
2. Configure BrowserLogin once from a terminal:

   ```sh
   browserlogin setup
   ```

   Enter the HTTPS BrowserLogin application origin, such as `https://app.example.com`, and an API key in the `bl_<KEY_ID>_<KEY_SECRET>` form. Do not enter `/api/v1` or `/mcp/browserSessionMCP`; BrowserLogin derives both paths from the origin.

3. Confirm the connection before configuring an AI client:

   ```sh
   browserlogin doctor --json
   ```

`browserlogin setup` stores the API key in the platform keychain and keeps the resulting MCP configuration free of credentials. In managed environments, give the AI client process a nonempty `BROWSERLOGIN_API_KEY`; `BROWSERLOGIN_BASE_URL` and `CLOAKBROWSER_LICENSE_KEY` are optional overrides. Never commit those values.

Every configuration in this guide starts the same stdio command:

```sh
browserlogin mcp
```

## Client configurations

Choose the entry for your AI client. The command must be available on the environment `PATH` used by that client, not only in an interactive shell.

<details>
<summary>Standard stdio JSON: Claude Desktop, Antigravity, Cursor, Gemini CLI, Junie, Kiro, and LM Studio</summary>

Add this server under the client's `mcpServers` object. For Cursor, add it in **Settings -> MCP** or `~/.cursor/mcp.json`; for Gemini CLI, use `~/.gemini/settings.json`; for Junie, use `.junie/mcp/mcp.json`; for Kiro, use `.kiro/settings/mcp.json`; and for LM Studio, use its MCP configuration editor.

```json
{
  "mcpServers": {
    "browserlogin": {
      "command": "browserlogin",
      "args": ["mcp"]
    }
  }
}
```

</details>

<details>
<summary>Claude Code</summary>

Add the local stdio server with the Claude Code CLI:

```sh
claude mcp add browserlogin browserlogin mcp
```

</details>

<details>
<summary>Codex</summary>

Add the server with Codex, or add the equivalent TOML entry to `~/.codex/config.toml`.

```sh
codex mcp add browserlogin -- browserlogin mcp
```

```toml
[mcp_servers.browserlogin]
command = "browserlogin"
args = ["mcp"]
```

</details>

<details>
<summary>GitHub Copilot CLI</summary>

Use `/mcp add` interactively, or add this entry to `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "browserlogin": {
      "type": "local",
      "command": "browserlogin",
      "tools": ["*"],
      "args": ["mcp"]
    }
  }
}
```

</details>

<details>
<summary>VS Code with GitHub Copilot</summary>

Install the server with the VS Code CLI:

```sh
code --add-mcp '{"name":"browserlogin","command":"browserlogin","args":["mcp"]}'
```

</details>

<details>
<summary>OpenCode</summary>

Add this to `~/.config/opencode/opencode.json` or the project's `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "browserlogin": {
      "type": "local",
      "command": ["browserlogin", "mcp"],
      "enabled": true
    }
  }
}
```

For migration from the former two-server setup, see [the OpenCode migration guide](opencode-migration.md).

</details>

<details>
<summary>Cline</summary>

Add this to Cline's `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "browserlogin": {
      "type": "stdio",
      "command": "browserlogin",
      "args": ["mcp"],
      "disabled": false
    }
  }
}
```

</details>

<details>
<summary>Amp</summary>

Add the server with the Amp CLI or put the equivalent configuration in Amp's VS Code settings:

```sh
amp mcp add browserlogin -- browserlogin mcp
```

</details>

<details>
<summary>Factory Droid</summary>

```sh
droid mcp add browserlogin "browserlogin mcp"
```

</details>

<details>
<summary>Grok</summary>

Add the server with the Grok CLI, or use the TOML configuration below.

```sh
grok mcp add browserlogin -- browserlogin mcp
```

```toml
[mcp_servers.browserlogin]
command = "browserlogin"
args = ["mcp"]
```

</details>

<details>
<summary>Goose, Qodo Gen, Warp, and Windsurf</summary>

Use the respective MCP settings UI: Goose (**Extensions -> Add custom extension**, type `STDIO`), Qodo Gen (**Connect more tools -> Add MCP**), Warp (**Settings -> AI -> Manage MCP Servers**), or Windsurf (**Cascade MCP settings**). Paste the standard stdio JSON from the first section, with `browserlogin` as the command and `mcp` as its sole argument.

</details>

## First AI workflow

1. Ask the client to call `browser_init` with `source: "free"` if CloakBrowser has not been installed. The download is explicit and can take longer than the AI client's default tool timeout. Use `browser_init_status` to inspect progress.
2. Ask it to call `browser_session_start` with the BrowserLogin `profile_id`.
3. Use browser tools with the same `profile` identifier. Browser tools only operate on a running BrowserLogin session.
4. End normally with `browser_session_stop` to preserve and upload the profile archive. Use `force: true` only when discarding local changes is acceptable.

`browser_close` also performs the normal BrowserLogin stop workflow for its required `profile`.

## Tool catalog

The default local catalog contains 28 tools: four lifecycle/bootstrap tools and 24 browser tools. Successful remote discovery adds 17 BrowserLogin workspace tools for a total of 45. `browser_run_code_unsafe` is hidden by default; setting `BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE=1` adds it, producing 29 local or 46 total tools.

All browser tools below require a running BrowserLogin session and a nonempty `profile` argument. An AI client can use `browser_snapshot` to obtain current element references before it acts.

<details>
<summary>Lifecycle and bootstrap tools (4)</summary>

| Tool                    | What the AI can do                                                       | Required arguments                            |
| ----------------------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| `browser_init`          | Download, verify, and install CloakBrowser.                              | None; optional `source`: `free` or `license`. |
| `browser_init_status`   | Report CloakBrowser download/install progress.                           | None.                                         |
| `browser_session_start` | Start the local BrowserLogin lifecycle for a profile.                    | `profile_id`                                  |
| `browser_session_stop`  | Stop a profile and commit its archive, or force-stop without an archive. | `profile_id`; optional `force` boolean.       |

</details>

<details>
<summary>Browser automation tools enabled by default (24)</summary>

| Tool                       | What the AI can do                                                       | Additional required arguments                          |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| `browser_close`            | Stop the BrowserLogin session and close its browser runtime.             | None.                                                  |
| `browser_resize`           | Resize the browser window.                                               | `width`, `height`                                      |
| `browser_console_messages` | Read browser console messages at a chosen severity.                      | `level`                                                |
| `browser_handle_dialog`    | Accept or dismiss a JavaScript dialog.                                   | `accept`                                               |
| `browser_evaluate`         | Evaluate a page or element JavaScript expression.                        | `function`                                             |
| `browser_file_upload`      | Upload one or more files, or cancel a file chooser.                      | None; optional `paths`                                 |
| `browser_drop`             | Drop files or MIME data onto an element.                                 | `target`; also provide `paths` or `data`               |
| `browser_find`             | Find text or a regular expression in the current accessibility snapshot. | Provide `text` or `regex`                              |
| `browser_fill_form`        | Fill multiple fields using BrowserLogin's humanized input path.          | `fields`                                               |
| `browser_press_key`        | Press a key or generate a character.                                     | `key`                                                  |
| `browser_type`             | Type text into an editable element with humanized typing.                | `target`, `text`                                       |
| `browser_navigate`         | Navigate the current tab to a URL.                                       | `url`                                                  |
| `browser_navigate_back`    | Return to the previous history entry.                                    | None.                                                  |
| `browser_network_requests` | List requests made since the current page loaded.                        | `static`                                               |
| `browser_network_request`  | Inspect request/response details from the numbered request list.         | `index`                                                |
| `browser_take_screenshot`  | Save a screenshot of the current page or an element.                     | `scale`                                                |
| `browser_snapshot`         | Capture an accessibility snapshot and element references.                | None.                                                  |
| `browser_click`            | Click an element.                                                        | `target`                                               |
| `browser_drag`             | Drag from one element to another.                                        | `startTarget`, `endTarget`                             |
| `browser_hover`            | Hover an element.                                                        | `target`                                               |
| `browser_select_option`    | Choose one option from a dropdown via the humanized input path.          | `target`, `values` (exactly one string)                |
| `browser_tabs`             | List, create, close, or select browser tabs.                             | `action`                                               |
| `browser_wait_for`         | Wait for text, disappearing text, or a duration.                         | None; provide `time`, `text`, or `textGone` as needed. |
| `browser_modal_watch`      | Let the agent handle the next upload prompt or JavaScript dialog.        | `kind`: `file_upload` or `dialog`                      |

</details>

<details>
<summary>Unsafe browser code tool (disabled by default)</summary>

| Tool                      | What the AI can do                                                                                                                                                | Required arguments                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `browser_run_code_unsafe` | Run arbitrary Playwright JavaScript in the browser-tools process. This is RCE-equivalent and is not advertised unless `BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE=1`. | None; provide `code` or `filename`. |

</details>

<details>
<summary>Remote BrowserLogin workspace tools (17, available after discovery)</summary>

These tools come from the BrowserLogin remote MCP service. They retain their remote names and schemas; proxy usernames and passwords are redacted from MCP results.

| Tool              | What the AI can do                                            | Required arguments                                                          |
| ----------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `profiles_list`   | List profiles the API key can access.                         | None.                                                                       |
| `profile_get`     | Read one profile.                                             | `profile_id`                                                                |
| `profile_create`  | Create a profile and optionally bind a workspace proxy.       | `idempotency_key`, `name`; optional profile settings.                       |
| `profile_update`  | Update profile configuration with optimistic concurrency.     | `profile_id`, `expected_config_version`, `name`; optional profile settings. |
| `profile_delete`  | Soft-delete a profile.                                        | `profile_id`                                                                |
| `profile_restore` | Restore a deleted profile.                                    | `profile_id`                                                                |
| `notes_get`       | Read current profile notes.                                   | `profile_id`                                                                |
| `notes_append`    | Append profile notes with optimistic concurrency.             | `profile_id`, `notes`, `expected_version`                                   |
| `notes_update`    | Replace profile notes with optimistic concurrency.            | `profile_id`, `notes`, `expected_version`                                   |
| `proxies_list`    | List workspace proxies with credentials redacted.             | None.                                                                       |
| `proxy_change_ip` | Request server-side proxy IP rotation and inspect its result. | `proxy_id`                                                                  |
| `members_list`    | List members of a profile.                                    | `profile_id`                                                                |
| `member_share`    | Share a profile with an editor or viewer.                     | `profile_id`, `user_id`, `role`                                             |
| `member_remove`   | Remove a profile member.                                      | `profile_id`, `user_id`                                                     |
| `users_list`      | List workspace users.                                         | None.                                                                       |
| `user_disable`    | Disable a workspace user.                                     | `user_id`                                                                   |
| `audit_list`      | List workspace audit events, optionally for a profile.        | None; optional `profile_id`                                                 |

The remote MCP intentionally does not expose session start/stop or archive transfer. Those operations are handled locally through `browser_session_start` and `browser_session_stop` so the client can manage the browser process and archive lifecycle safely. See the [API guide](api.md#mcp-contract) for the remote transport and authorization contract.

</details>

## Troubleshooting

- `BrowserLogin connection setup is required`: run `browserlogin setup`, or give the AI client process `BROWSERLOGIN_API_KEY` and, if needed, `BROWSERLOGIN_BASE_URL`.
- `CloakBrowser is not initialized`: call `browser_init` and wait for `browser_init_status` to report `ready`, then retry the session start.
- `PROFILE_NOT_RUNNING`: call `browser_session_start` before browser automation, and pass the exact same profile ID as `profile`.
- Remote workspace tools are missing: run `browserlogin doctor --json` and verify the app origin/API key. The lifecycle and browser tools remain available in degraded local-only mode.
- The client cannot find `browserlogin`: install the CLI with `browserlogin install-cli` or put the release CLI directory on the AI client's inherited `PATH`.
