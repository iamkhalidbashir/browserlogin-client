# BrowserLogin CLI guide

The compiled `browserlogin` command configures BrowserLogin, manages local browser-session lifecycles, verifies CloakBrowser downloads, reports diagnostics, and starts the unified MCP server.

The CLI, desktop app, and MCP server share one private state root. Configuration made with one surface is available to the others.

## Install

Download the platform-specific `browserlogin-<version>-<platform>` asset and the matching `browserlogin-browser-tools-<platform>` helper from [GitHub Releases](https://github.com/iamkhalidbashir/browserlogin-client/releases). Keep the helper beside the CLI under its release filename, make the CLI executable where required, and place it on your `PATH` as `browserlogin`.

If the compiled CLI is already running, install it in the user CLI location with:

```sh
browserlogin install-cli
```

On macOS and Linux that location is `~/.local/bin/browserlogin`; on Windows it is `%LOCALAPPDATA%\Programs\browserlogin\browserlogin.exe`.

## Configure a connection

Run the interactive setup once:

```sh
browserlogin setup
```

Provide the HTTPS BrowserLogin application origin and a BrowserLogin API key. Use the application origin, for example `https://app.example.com`, rather than a REST or MCP path. BrowserLogin derives `${origin}/api/v1` for REST and `${origin}/mcp/browserSessionMCP` for remote MCP discovery.

The app origin is stored in the private state root. The API key is stored in the operating-system keychain instead of the configuration file.

For managed or headless environments, provide credentials to the process environment rather than an interactive prompt:

```sh
export BROWSERLOGIN_API_KEY='bl_<KEY_ID>_<KEY_SECRET>'
export BROWSERLOGIN_BASE_URL='https://app.example.com'
export CLOAKBROWSER_LICENSE_KEY='<OPTIONAL_LICENSE_KEY>'
browserlogin doctor --json
```

Only `BROWSERLOGIN_API_KEY` is required. `BROWSERLOGIN_BASE_URL` and `CLOAKBROWSER_LICENSE_KEY` are optional. `browserlogin setup --api-key-env` prints the same environment-mode reminder without changing local configuration.

Never commit credentials or put them in shell history, repository configuration, or MCP configuration files.

## Quickstart

```sh
browserlogin setup
browserlogin binary download
browserlogin profiles --json
browserlogin start <PROFILE_ID>
browserlogin status --json
browserlogin stop <PROFILE_ID>
```

`binary download` is explicit. Running `start` does not silently download a CloakBrowser binary, so install a verified browser before the first lifecycle start.

## Commands

| Command                                          | Behavior                                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `browserlogin profiles [--json]`                 | List accessible profile IDs, names, platforms, archive generations, and coarse remote-session state. The command writes stable JSON rows.                                                  |
| `browserlogin start <profile_id>`                | Start or recover the profile's BrowserLogin session and local CloakBrowser runner. Use `--json` to print the returned lifecycle state.                                                     |
| `browserlogin stop <profile_id>`                 | Stop normally: package and verify the local archive, upload it, commit the remote session stop, and release the profile lock. Use `--json` to print the returned lifecycle state.          |
| `browserlogin stop <profile_id> --force [--yes]` | Force-stop without committing an archive. Interactive use requires typing `FORCE CLOSE <profile_id>` exactly; noninteractive use requires `--yes`. This can discard local browser changes. |
| `browserlogin setup [--api-key-env]`             | Interactively save the application origin and API key, or show the environment-mode requirement.                                                                                           |
| `browserlogin status [--json]`                   | Print stable JSON containing live sessions, active binary status, and update status.                                                                                                       |
| `browserlogin binary download [--pro]`           | Download and verify the configured free CloakBrowser build; use `--pro` when downloading the licensed build.                                                                               |
| `browserlogin doctor [--json]`                   | Print stable JSON for connection status, state-root path, relay port `4290`, and derived remote MCP configuration. Exit `2` when setup is required.                                        |
| `browserlogin mcp`                               | Start the unified stdio MCP server. Standard output is reserved for JSON-RPC traffic.                                                                                                      |
| `browserlogin install-cli`                       | Copy the current executable to the platform user CLI location and print the installed path and an MCP configuration fragment.                                                              |
| `browserlogin help` or `browserlogin --help`     | Print the supported command syntax.                                                                                                                                                        |

## Options and exit codes

| Option                        | Behavior                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `--state-dir <absolute-path>` | Override the shared state root for this invocation. The path must be absolute.                                              |
| `--json`                      | Request structured JSON from commands that support a human-readable form. Read/status commands already produce stable JSON. |
| `--verbose`                   | Add an unknown-command diagnostic before usage output.                                                                      |
| `--force`                     | Select the archive-discarding force-stop path. Valid for `stop`.                                                            |
| `--yes`                       | Skip the exact force-close prompt. It is valid only with `stop --force`.                                                    |
| `--pro`                       | Select the licensed CloakBrowser download channel. Use with `binary download`.                                              |
| `--api-key-env`               | Show environment-mode setup instructions. Use with `setup`.                                                                 |

The CLI exits `0` on success, `2` for invalid usage or required setup, and `3` for an operational failure.

## State and environment

Default state roots are:

- macOS: `~/Library/Application Support/BrowserLogin`
- Windows: `%LOCALAPPDATA%\BrowserLogin`
- Linux: `$XDG_STATE_HOME/browserlogin`, or `~/.local/state/browserlogin`

`BROWSERLOGIN_STATE_DIR` is an environment-level state-root override and must be absolute. CLI `--state-dir` takes precedence for its invocation.

| Variable                                   | Meaning                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `BROWSERLOGIN_API_KEY`                     | Nonempty BrowserLogin API key override.                                             |
| `BROWSERLOGIN_BASE_URL`                    | Canonical HTTPS BrowserLogin application origin.                                    |
| `BROWSERLOGIN_API_BASE_URL`                | Legacy REST root; BrowserLogin converts it to an application origin.                |
| `CLOAKBROWSER_LICENSE_KEY`                 | Optional CloakBrowser license-key override.                                         |
| `BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE=1` | Advertise the RCE-equivalent `browser_run_code_unsafe` MCP tool.                    |
| `BROWSERLOGIN_LAUNCH_TIMING=1`             | Emit redacted launch-stage durations to standard error for development diagnostics. |

When resolving a connection, explicit CLI values take precedence over environment variables, followed by the keychain/persisted configuration and then the default application origin. Environment credentials intentionally take precedence over keychain credentials.

## MCP from the CLI

Run the server directly when diagnosing an MCP client:

```sh
browserlogin mcp
```

Do not type into or redirect its standard output: MCP uses standard input/output for protocol messages. Configure an AI client to launch the command instead. See the [MCP guide](mcp.md) for ready-to-copy integrations and the complete AI tool catalog.

## Common problems

- **Setup required:** run `browserlogin setup`, or set `BROWSERLOGIN_API_KEY` for the current process.
- **No verified browser:** run `browserlogin binary download` before `start`.
- **Force close rejected:** type the exact required confirmation, or use `--force --yes` only when archive loss is intentional.
- **Remote MCP tools unavailable:** `browserlogin doctor --json` shows the derived remote MCP configuration. Lifecycle and local browser tools remain available to the unified server if remote discovery fails.
- **Different terminal/app state:** confirm both processes use the same state root and credential source, or pass the intended `--state-dir` explicitly.
