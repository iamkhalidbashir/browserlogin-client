# BrowserLogin Client

[![CI](https://github.com/iamkhalidbashir/browserlogin-client/actions/workflows/ci.yml/badge.svg)](https://github.com/iamkhalidbashir/browserlogin-client/actions/workflows/ci.yml)

BrowserLogin Client is a source-available desktop, CLI, and unified MCP client for BrowserLogin profiles and CloakBrowser sessions. It shares one private state root across interfaces, stores credentials through the operating-system keychain adapter, and preserves profile data through verified archive workflows.

## Features

- Electrobun desktop application for setup, profile launch, session monitoring, administration, notes/audit history, downloads, updates, logs, and settings.
- Compiled `browserlogin` CLI for setup, profiles, lifecycle operations, diagnostics, binary downloads, and MCP startup.
- One local MCP server combining BrowserLogin lifecycle tools, profile-scoped browser tools, and 17 remote BrowserSessionMCP tools when available.
- Humanized input using a verified ONNX policy with bounded classical fallback.
- Verified official CloakBrowser downloads, isolated custom-source installs, and explicit trust labels.
- Recovery and idempotency guards for interrupted starts, uploads, stops, and force stops.

> BrowserLogin Client does not bundle or publish a CloakBrowser/Chromium binary. It downloads a verified browser at runtime when required.

## Screenshots

| Profiles and launch                                         | Administration                                                 | Settings                                                    |
| ----------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| ![Profiles screen with mock data](docs/images/profiles.png) | ![Administration screen with mock data](docs/images/admin.png) | ![Settings screen with mock data](docs/images/settings.png) |

The screenshots use local mock data and contain no production credentials or servers.

## Install

Download the asset for your platform from [GitHub Releases](https://github.com/iamkhalidbashir/browserlogin-client/releases). Release artifacts are unsigned until a signing/notarization process is introduced.

Release filenames use the version without the tag's leading `v`: tag `v0.1.1` produces filenames containing `0.1.1`.

### macOS ARM64

1. Download `BrowserLogin-<version>-macos-arm64.dmg`, open it, and move BrowserLogin to Applications.
2. On first launch, use Finder **right-click → Open** to approve the unsigned application. As an explicit alternative, remove quarantine metadata yourself with `xattr -cr /Applications/BrowserLogin.app` after verifying the checksum.
3. For terminal/MCP use, download `browserlogin-<version>-macos-arm64` plus `browserlogin-browser-tools-macos-arm64`. Make both executable, place the CLI on `PATH` as `browserlogin`, and keep the helper beside it under its release filename.

### Windows x64

1. Download and extract `BrowserLogin-<version>-windows-x64-Setup.zip`, then run the installer.
2. If SmartScreen appears, select **More info → Run anyway** after verifying the checksum.
3. Download `browserlogin-<version>-windows-x64.exe` plus `browserlogin-browser-tools-windows-x64.exe`. Place both in the same directory, put that directory on `PATH`, and rename only the CLI to `browserlogin.exe`.

### Linux x64

1. On Ubuntu 24.04 or newer, install the runtime dependencies:

   ```sh
   sudo apt-get update
   sudo apt-get install -y libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1
   ```

2. Download and extract `BrowserLogin-<version>-linux-x64-Setup.tar.gz`, then run the included installer.
3. Alternatively, download `BrowserLogin-<version>-linux-x64.AppImage`, make it executable, and run it. AppImage execution may require the distribution's FUSE 2 compatibility package.
4. Download `browserlogin-<version>-linux-x64` plus `browserlogin-browser-tools-linux-x64`, make both executable, place the CLI on `PATH` as `browserlogin`, and keep the helper beside it under its release filename.

Verify every downloaded file against the release `SHA256SUMS` before running it.

## Quickstart

Start the desktop application and complete the connection form, or configure the same connection from a terminal:

```sh
browserlogin setup
browserlogin profiles --json
browserlogin start PROFILE_ID
browserlogin status --json
browserlogin stop PROFILE_ID
```

`setup` stores the HTTPS application origin plus a keychain marker in the private state root; the API key goes to the platform keychain backend. REST uses `${origin}/api/v1` and remote MCP uses `${origin}/mcp/browserSessionMCP`. For managed environments, set `BROWSERLOGIN_API_KEY` (optionally `BROWSERLOGIN_BASE_URL` and `CLOAKBROWSER_LICENSE_KEY`) and run:

```sh
browserlogin setup --api-key-env
```

Force close discards uncommitted local browser changes and requires explicit confirmation:

```sh
browserlogin stop PROFILE_ID --force --yes
```

## CLI and MCP

The compiled CLI handles setup, profile lifecycle, diagnostics, verified browser downloads, and the unified MCP server. See the [CLI guide](docs/cli.md) for the full command contract, options, environment precedence, exit codes, and troubleshooting.

Use one local stdio MCP server for AI clients. It combines BrowserLogin lifecycle tools, profile-scoped browser automation, and remote BrowserLogin workspace tools. Run `browserlogin setup` once before connecting a client so the API key stays in the OS keychain rather than an AI-client configuration file.

<details>
<summary>AI client integrations</summary>

<details>
<summary>Standard stdio JSON: Claude Desktop, Antigravity, Cursor, Gemini CLI, Junie, Kiro, and LM Studio</summary>

Add this server under the client's `mcpServers` object. Cursor supports `~/.cursor/mcp.json`; Gemini CLI uses `~/.gemini/settings.json`; Junie uses `.junie/mcp/mcp.json`; Kiro uses `.kiro/settings/mcp.json`; and LM Studio provides an MCP configuration editor.

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

```sh
claude mcp add browserlogin browserlogin mcp
```

</details>

<details>
<summary>Codex</summary>

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

Add this to `~/.copilot/mcp-config.json`:

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

</details>

<details>
<summary>Cline</summary>

Add this to `cline_mcp_settings.json`:

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
<summary>Amp, Factory Droid, and Grok</summary>

```sh
amp mcp add browserlogin -- browserlogin mcp
droid mcp add browserlogin "browserlogin mcp"
grok mcp add browserlogin -- browserlogin mcp
```

Grok also accepts the Codex-style TOML entry in `~/.grok/config.toml`.

</details>

<details>
<summary>Goose, Qodo Gen, Warp, and Windsurf</summary>

Add a local/stdio MCP server in the client settings and paste the standard stdio JSON above. In Goose, choose **Extensions -> Add custom extension** with type `STDIO`; in Qodo Gen, use **Connect more tools -> Add MCP**; in Warp, use **Settings -> AI -> Manage MCP Servers**; and in Windsurf, use **Cascade MCP settings**.

</details>

`browserlogin` must be on the `PATH` inherited by the AI client. The [MCP guide](docs/mcp.md) contains the same integrations with additional setup, workflow, and troubleshooting detail.

</details>

<details>
<summary>Available AI tools</summary>

The default local server advertises 28 tools: four lifecycle/bootstrap tools and 24 browser automation tools. Successful remote discovery adds 17 BrowserLogin workspace tools, for 45 total. `BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE=1` exposes the disabled-by-default RCE-equivalent `browser_run_code_unsafe` tool, for 29 local or 46 total.

<details>
<summary>Lifecycle and bootstrap (4)</summary>

- `browser_init`: download, verify, and install CloakBrowser.
- `browser_init_status`: report browser initialization progress.
- `browser_session_start`: start a BrowserLogin profile session.
- `browser_session_stop`: stop normally or force-stop with `force: true`.

</details>

<details>
<summary>Browser automation (24)</summary>

- `browser_close`, `browser_resize`, `browser_console_messages`, `browser_handle_dialog`
- `browser_evaluate`, `browser_file_upload`, `browser_drop`, `browser_find`
- `browser_fill_form`, `browser_press_key`, `browser_type`, `browser_navigate`, `browser_navigate_back`
- `browser_network_requests`, `browser_network_request`, `browser_take_screenshot`, `browser_snapshot`
- `browser_click`, `browser_drag`, `browser_hover`, `browser_select_option`, `browser_tabs`, `browser_wait_for`, `browser_modal_watch`

Each browser tool requires a running session and its `profile` ID. `browser_snapshot` supplies current element references before the AI acts.

</details>

<details>
<summary>Remote BrowserLogin workspace tools (17)</summary>

- Profiles: `profiles_list`, `profile_get`, `profile_create`, `profile_update`, `profile_delete`, `profile_restore`
- Notes and proxies: `notes_get`, `notes_append`, `notes_update`, `proxies_list`, `proxy_change_ip`
- Members, users, and audit: `members_list`, `member_share`, `member_remove`, `users_list`, `user_disable`, `audit_list`

Remote tools retain their BrowserLogin schemas and redact proxy credentials. Remote session lifecycle and archive transfer stay local, so the AI uses `browser_session_start` and `browser_session_stop` for those operations.

</details>

<details>
<summary>Unsafe browser code (1, opt-in)</summary>

- `browser_run_code_unsafe`: run arbitrary Playwright JavaScript. It is RCE-equivalent and appears only when `BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE=1` is set for the MCP server process.

</details>

The [MCP guide](docs/mcp.md) contains every tool's purpose and required arguments in collapsible tables, the first-session workflow, and troubleshooting.

</details>

The canonical local lifecycle tools are `browser_session_start` and `browser_session_stop`. OpenCode exposes them under its server namespace, for example `browserlogin_browser_session_start`. The legacy `browserlogin_session_start` and `browserlogin_session_stop` names remain hidden compatibility names; they are handled locally and are never forwarded to the remote MCP service.

## State and environment

Default state roots:

- macOS: `~/Library/Application Support/BrowserLogin`
- Windows: `%LOCALAPPDATA%\BrowserLogin`
- Linux: `$XDG_STATE_HOME/browserlogin`, otherwise `~/.local/state/browserlogin`

`BROWSERLOGIN_STATE_DIR` must be absolute.

| Variable                                   | Meaning                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `BROWSERLOGIN_API_KEY`                     | Nonempty BrowserLogin key override; never commit it.                                         |
| `BROWSERLOGIN_BASE_URL`                    | Canonical HTTPS BrowserLogin application origin.                                             |
| `BROWSERLOGIN_API_BASE_URL`                | Legacy exact REST root (`${origin}/api/v1`) converted to the origin.                         |
| `CLOAKBROWSER_LICENSE_KEY`                 | Optional CloakBrowser license-key override.                                                  |
| `BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE=1` | Expose RCE-equivalent `browser_run_code_unsafe`.                                             |
| `BROWSERLOGIN_LAUNCH_TIMING=1`             | Emit development launch-stage durations to stderr without identifiers, URLs, or credentials. |

See [the architecture guide](docs/architecture.md) for the complete security and process model.

## Updating

The app checks the rolling `stable` release metadata. Unsigned automatic apply was not proven reliable on every platform, so the UI provides **Update available – download** and links to the tagged GitHub Release. Prerelease tags publish tagged artifacts but do not mutate `stable`.

## Development

Requirements: Bun `1.2.23`, Hutch, and the native dependencies shown in CI. The
development commands resolve Hutch from `HUTCH_BIN`, then
`~/.hutch/bin/hutch`, then `PATH`.

```sh
bun install --frozen-lockfile
bun run electrobun:sync
bun run typecheck
bun run lint
bun run test
bun run test:integration
bun run test:contract
bun run test:e2e
bun run notices:check
```

Start a development app with a disposable state root and wait for readiness:

```sh
export BROWSERLOGIN_STATE_DIR="$(mktemp -d -t browserlogin-dev.XXXXXX)"
bun run dev &
BROWSERLOGIN_DEV_PID=$!
bun scripts/wait-for-app.ts
kill "$BROWSERLOGIN_DEV_PID"
wait "$BROWSERLOGIN_DEV_PID" || true
python3 -c 'import os, shutil; shutil.rmtree(os.environ["BROWSERLOGIN_STATE_DIR"])'
```

The readiness command prints the private `ready/main-process.json` path. Always stop the captured parent process after development.

## Documentation

- [CLI guide](docs/cli.md)
- [MCP integrations and AI tool catalog](docs/mcp.md)
- [API guide](docs/api.md)
- [Architecture, security, and updates](docs/architecture.md)
- [OpenCode migration](docs/opencode-migration.md)
- [Bumblebee model provenance](docs/bumblebee.md)
- [Third-party notices](NOTICES.md)

## License

This project is **source-available**, not OSI-approved open source. It uses Business Source License 1.1 with an additional grant for personal, non-commercial use. The Change Date is `2030-08-16`, the Change License is Apache-2.0, and the license changes on that date or the fourth anniversary of the first public release of that version, whichever occurs first. See [LICENSE](LICENSE).
