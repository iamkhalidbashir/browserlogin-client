[![CI](https://github.com/iamkhalidbashir/browserlogin-client/actions/workflows/ci.yml/badge.svg)](https://github.com/iamkhalidbashir/browserlogin-client/actions/workflows/ci.yml)

BrowserLogin Client is a source-available desktop application and standalone CLI for BrowserLogin profiles and CloakBrowser sessions. Both interfaces share the same private state and operating-system keychain credentials.

## Features

- Electrobun desktop application for connection setup, profile launch, session monitoring, administration, notes, audit history, downloads, updates, logs, and settings.
- Standalone `browserlogin` terminal executable for setup, profile lifecycle, diagnostics, browser downloads, and stdio MCP.
- App-owned local MCP endpoint that combines browser control with BrowserLogin workspace tools after Connection setup.
- Optional public MCP fallback for hosted workspace tools when a client cannot reach localhost.
- Humanized input using a verified ONNX policy with bounded classical fallback.
- Verified official CloakBrowser downloads, isolated custom-source installs, and explicit trust labels.
- Recovery and idempotency guards for interrupted starts, uploads, stops, and force stops.

> BrowserLogin Client does not publish CloakBrowser or Chromium as a separate release asset. It downloads a verified browser at runtime when required.

## Screenshots

| Profiles and launch                                         | Administration                                                 | Settings                                                    |
| ----------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| ![Profiles screen with mock data](docs/images/profiles.png) | ![Administration screen with mock data](docs/images/admin.png) | ![Settings screen with mock data](docs/images/settings.png) |

The screenshots use local mock data and contain no production credentials or servers.

## Install

Download the BrowserLogin app for your platform from [GitHub Releases](https://github.com/iamkhalidbashir/browserlogin-client/releases). Verify every downloaded file against the release `SHA256SUMS` before running it.

Release filenames use the version without the tag's leading `v`: tag `v0.1.33` produces filenames containing `0.1.33`.

### macOS ARM64

Download `BrowserLogin-<version>-macos-arm64.dmg`, open it, and move BrowserLogin to Applications.

### Windows x64

Download and extract `BrowserLogin-<version>-windows-x64-Setup.zip`, then run `Install-BrowserLogin.cmd`. Keep the adjacent `.installer` directory with the installer files.

### Linux x64

On Ubuntu 24.04 or newer, install the runtime dependencies:

```sh
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1
```

Then use either `BrowserLogin-<version>-linux-x64-Setup.tar.gz` or `BrowserLogin-<version>-linux-x64.AppImage`. AppImage execution may require the distribution's FUSE 2 compatibility package.

### Standalone CLI

Download both files for the target platform and keep them in the same directory:

- macOS ARM64: `browserlogin-<version>-macos-arm64` and `browserlogin-browser-tools-macos-arm64`
- Windows x64: `browserlogin-<version>-windows-x64.exe` and `browserlogin-browser-tools-windows-x64.exe`
- Linux x64: `browserlogin-<version>-linux-x64` and `browserlogin-browser-tools-linux-x64`

On macOS and Linux, mark both files executable. Run the versioned CLI directly or rename it to `browserlogin`; `browserlogin install-cli` copies the CLI and matching helper into the user CLI directory.

## Quickstart

1. Open BrowserLogin.
2. Connect an AI client to the local MCP endpoint. Its 29 local tools are available before Connection setup.
3. Complete the Connection form to add 17 hosted workspace tools. The API key is stored through the operating-system keychain backend.
4. Download the verified browser from the app when prompted, then start a profile from the Profiles screen or through MCP.

The local MCP server starts and stops with the desktop app:

```text
http://127.0.0.1:43110/mcp
```

Keep BrowserLogin open while using MCP. The endpoint binds only to loopback, does not require an MCP authorization header, and exposes 46 safe-default tools after Connection setup: 29 local tools plus 17 hosted workspace tools.

For terminal-only use, run `browserlogin setup`, then use commands such as `browserlogin profiles --json`, `browserlogin start PROFILE_ID`, and `browserlogin stop PROFILE_ID` without opening the desktop app.

## MCP Connections

Use one BrowserLogin MCP connection. The app-owned HTTP endpoint is the recommended default; the standalone CLI provides the same merged registry over stdio for terminal-only clients.

| Connection                    | Address or command                                                               | Safe-default tools                                       | Authentication                                 |
| ----------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| App-owned HTTP                | `http://127.0.0.1:43110/mcp`                                                     | 29 local tools before setup; 46 merged tools after setup | Managed by the app; no MCP header              |
| Standalone stdio              | `browserlogin mcp`                                                               | 46 merged tools after `browserlogin setup`               | CLI keychain or environment setup              |
| Optional hosted-only fallback | `https://noble-spark-8295-06576bc2.app-csite-env.sapps.co/mcp/browserSessionMCP` | 17 workspace tools; no local browser control             | `Authorization: Bearer <BROWSERLOGIN_API_KEY>` |

The public URL is only a fallback for clients that cannot reach localhost. It is not a required second connection and cannot launch or control a local browser.

### OpenCode Example

Add the primary local endpoint to `opencode.json`:

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

Other MCP clients should use their remote or Streamable HTTP transport with the same local URL and no headers. If localhost is unavailable, use the hosted-only fallback URL with `Authorization: Bearer <BROWSERLOGIN_API_KEY>`; store the key through the client's secret or environment mechanism and never commit it.

### Tool Boundaries

The local HTTP endpoint starts with 29 safe-default local tools:

- Four lifecycle/bootstrap tools: `browser_init`, `browser_init_status`, `browser_session_start`, and `browser_session_stop`.
- One user-controlled attention tool: `browserlogin_request_attention`. It remains disabled until the user enables notification, audio, or both in Settings.
- Twenty-four profile-scoped browser automation tools for navigation, snapshots, input, files, tabs, dialogs, network inspection, and screenshots.

After Connection setup it adds 17 workspace tools covering profiles, notes, proxies, members, users, and audit events, for 46 tools through the same connection. `browserlogin mcp` exposes the same 46-tool merged registry after CLI setup. Enabling `browser_run_code_unsafe` raises the local and merged totals to 30 and 47 respectively.

The optional public fallback exposes only the 17 workspace tools. See the [MCP guide](docs/mcp.md) for configuration, the complete tool catalog, and troubleshooting.

## State And Environment

Default state roots:

- macOS: `~/Library/Application Support/BrowserLogin`
- Windows: `%LOCALAPPDATA%\BrowserLogin`
- Linux: `$XDG_STATE_HOME/browserlogin`, otherwise `~/.local/state/browserlogin`

`BROWSERLOGIN_STATE_DIR` must be absolute.

| Variable                                   | Meaning                                                         |
| ------------------------------------------ | --------------------------------------------------------------- |
| `BROWSERLOGIN_API_KEY`                     | Nonempty BrowserLogin key override; never commit it.            |
| `BROWSERLOGIN_BASE_URL`                    | Canonical HTTPS BrowserLogin application origin.                |
| `BROWSERLOGIN_API_BASE_URL`                | Legacy exact REST root converted to the application origin.     |
| `CLOAKBROWSER_LICENSE_KEY`                 | Optional CloakBrowser license-key override.                     |
| `BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE=1` | Expose the RCE-equivalent local `browser_run_code_unsafe` tool. |
| `BROWSERLOGIN_LAUNCH_TIMING=1`             | Emit redacted development launch-stage durations.               |

## Updating

The app checks the rolling `stable` release metadata. The UI links to the tagged GitHub Release when an update is available. Prerelease tags do not mutate `stable`.

## Development

Requirements: Bun `1.4.0`, Hutch, and the native dependencies shown in CI.

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
```

The private readiness record includes the app-owned `mcp_url`.

## Documentation

- [MCP integrations and AI tool catalog](docs/mcp.md)
- [Standalone CLI guide](docs/cli.md)
- [API guide](docs/api.md)
- [Architecture, security, and updates](docs/architecture.md)
- [Bumblebee model provenance](docs/bumblebee.md)
- [Third-party notices](NOTICES.md)

## License

This project is **source-available**, not OSI-approved open source. It uses Business Source License 1.1 with an additional grant for personal, non-commercial use. The Change Date is `2030-08-16`, the Change License is Apache-2.0, and the license changes on that date or the fourth anniversary of the first public release of that version, whichever occurs first. See [LICENSE](LICENSE).
