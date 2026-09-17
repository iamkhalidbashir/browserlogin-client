# BrowserLogin CLI

The standalone `browserlogin` executable supports terminal-only BrowserLogin operation. It does not require the desktop app to be installed or running.

## Install

Download the CLI and matching browser-tools helper for the same platform from [GitHub Releases](https://github.com/iamkhalidbashir/browserlogin-client/releases):

| Platform    | CLI                                      | Required helper                              |
| ----------- | ---------------------------------------- | -------------------------------------------- |
| macOS ARM64 | `browserlogin-<version>-macos-arm64`     | `browserlogin-browser-tools-macos-arm64`     |
| Windows x64 | `browserlogin-<version>-windows-x64.exe` | `browserlogin-browser-tools-windows-x64.exe` |
| Linux x64   | `browserlogin-<version>-linux-x64`       | `browserlogin-browser-tools-linux-x64`       |

Verify both files against `SHA256SUMS` and keep them in the same directory. On macOS and Linux, mark both files executable:

```sh
chmod +x browserlogin-* browserlogin-browser-tools-*
```

Rename the versioned executable to `browserlogin`, place its directory on `PATH`, or run `browserlogin install-cli`. Self-install copies both the CLI and matching helper into the user CLI directory.

## Setup

Interactive setup stores the API key through the operating-system keychain backend:

```sh
browserlogin setup
```

For managed environments, provide a nonempty `BROWSERLOGIN_API_KEY`. Optional overrides are `BROWSERLOGIN_BASE_URL` and `CLOAKBROWSER_LICENSE_KEY`:

```sh
browserlogin setup --api-key-env
```

Never commit credentials. Desktop and CLI processes using the same state root share persisted connection metadata and keychain entries.

## Commands

| Command                                          | Purpose                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `browserlogin profiles [--json]`                 | List accessible profiles with stable JSON fields.                                        |
| `browserlogin start <profile_id>`                | Start or recover the profile's BrowserLogin session and local browser runtime.           |
| `browserlogin stop <profile_id>`                 | Stop normally, preserving and uploading the profile archive.                             |
| `browserlogin stop <profile_id> --force [--yes]` | Force-stop without committing local browser changes.                                     |
| `browserlogin setup [--api-key-env]`             | Save connection credentials or print environment-mode guidance.                          |
| `browserlogin status [--json]`                   | Report live sessions, browser binary state, and update state.                            |
| `browserlogin binary download [--pro]`           | Download and verify the configured CloakBrowser build.                                   |
| `browserlogin doctor [--json]`                   | Check connection setup, state root, relay port, and remote MCP derivation.               |
| `browserlogin mcp`                               | Start the standalone stdio MCP server with the merged local and workspace tool registry. |
| `browserlogin install-cli`                       | Install the current CLI and adjacent helper into the user CLI directory.                 |

`--state-dir` accepts an absolute state-root override. `--verbose` adds diagnostics for invalid commands without exposing credentials.

## Safe Stop

Normal stop preserves browser changes:

```sh
browserlogin stop PROFILE_ID
```

Force stop can discard local changes. Interactive use requires the exact confirmation `FORCE CLOSE PROFILE_ID`; noninteractive automation must pass both `--force` and `--yes`.

## Stdio MCP

After setup, configure an MCP client to run:

```text
browserlogin mcp
```

The stdio server exposes one 45-tool safe-default registry: 28 local lifecycle/browser tools plus 17 hosted workspace tools. It uses the credentials saved by `browserlogin setup`, so the MCP client needs no second BrowserLogin connection or authorization header. Standard output contains JSON-RPC only. See the [MCP guide](mcp.md) for client configuration and tool boundaries.

## Exit Codes

- `0`: success.
- `2`: usage error or setup required.
- `3`: operation or lifecycle failure.

## Troubleshooting

- `BrowserLogin connection setup is required`: run `browserlogin setup` or provide the API key environment variable.
- `packaged browser tools helper is unavailable`: keep the matching helper executable beside the CLI or rerun self-install from the extracted release pair.
- `CloakBrowser is not initialized`: run `browserlogin binary download` before starting a profile.
- AI client cannot find `browserlogin`: add the installed directory to the client process's inherited `PATH`.
