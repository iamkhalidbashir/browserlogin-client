# Electrobun 2.x CI and Unsigned Updater Spike

Date: 2026-08-16

## Decision

Native three-runner Electrobun 2.x builds are a GO for the BrowserLogin
scaffold. Unsigned updater check and download work on macOS arm64. Unsigned
apply was not accepted as a reliable release UX: the local apply probe did not
produce a completion signal and left the child process active. Linux and
Windows updater application were not attempted because the proof requires a
native installed app on those runners. The selected UX is the pre-decided
fallback: show `Update available - download` and deep-link to the GitHub
Release page when an unsigned apply cannot be proven.

The spike never published to `stable`. The temporary `stable-spike` release
was deleted with its tag after the updater probe; both release and tag lookups
returned 404 afterward.

## Pins and Configuration

- Bun package manager: `1.2.23` from `.bun-version` and `package.json`.
- Electrobun bootstrap: `2.0.1-beta.14` in `package.json` and `bun.lock`.
- Hutch: `0.10.0` in the first-line `hutch.config.ts` pragma.
- Cottontail: `0.4.4` in the same Hutch pragma.
- Electrobun project pin: `2.0.1-beta.14` in `hutch.config.ts`.
- App name: `BrowserLogin`.
- Identifier: `co.browserlogin.app`.
- Release base URL: `https://github.com/iamkhalidbashir/browserlogin-client/releases/download/stable`.
- Main process: Cottontail entrypoint `src/bun/index.ts`.
- View: copied from `src/mainview/index.html` to `views/mainview/index.html`.
- Signing: disabled on macOS; no signing secrets were supplied.

The 2.x split was verified against the official migration and Hutch docs:

- https://github.com/blackboardsh/electrobun/blob/main/docs/src/content/docs/electrobun/guides/migrating-to-v2.mdx
- https://github.com/blackboardsh/electrobun/blob/main/docs/src/content/docs/electrobun/guides/hutch.mdx
- https://github.com/blackboardsh/electrobun/blob/main/.github/workflows/release.yml
- https://github.com/blackboardsh/electrobun/blob/main/kitchen/electrobun.config.ts
- https://github.com/blackboardsh/electrobun/blob/main/docs/src/content/docs/electrobun/guides/updates.mdx

The canonical proven workflow is `.github/workflows/spike-release.yml` at
commit `62c590ba9f54aa0cc4af50438476d6750d7dbf09`. It uses the exact matrix
below and uploads the unrenamed `artifacts/*` directory:

```yaml
matrix:
  include:
    - target: macos-arm64
      runner: macos-14
    - target: windows-x64
      runner: windows-2025
    - target: linux-x64
      runner: ubuntu-24.04
```

The workflow installs `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`,
`libayatana-appindicator3-dev`, `build-essential`, `cmake`, `pkg-config`, and
`xvfb` on Ubuntu, runs `hutch electrobun sync`, then
`hutch electrobun build --env=production`. macOS/Linux use `uname -m`; Windows
uses `RuntimeInformation.OSArchitecture` and `PROCESSOR_ARCHITECTURE`.

## Matrix Run

Final proof run: https://github.com/iamkhalidbashir/browserlogin-client/actions/runs/31918450450

| Target | Job URL | Architecture evidence | Result |
| --- | --- | --- | --- |
| macOS arm64 | https://github.com/iamkhalidbashir/browserlogin-client/actions/runs/31918450450/job/95094200514 | `macos-14`, `uname=arm64` | build, format validation, extracted launcher smoke PASS |
| Windows x64 | https://github.com/iamkhalidbashir/browserlogin-client/actions/runs/31918450450/job/95094200422 | `windows-2025`, `OSArchitecture=X64`, `PROCESSOR_ARCHITECTURE=AMD64` | build, format validation, extracted `launcher.exe` smoke PASS |
| Linux x64 | https://github.com/iamkhalidbashir/browserlogin-client/actions/runs/31918450450/job/95094200464 | `ubuntu-24.04`, `uname=x86_64` | build, format validation, extracted launcher under `xvfb` smoke PASS |

All three jobs and all steps completed successfully. The first run exposed
that launcher command-line arguments are not forwarded to the Cottontail
child; the final workflow uses `BROWSERLOGIN_SPIKE_SMOKE=1`, and the final run
was dispatched after that fix.

## Artifacts

The final run produced these exact artifacts:

macOS arm64:

- `production-macos-arm64-BrowserLogin.dmg`
- `production-macos-arm64-BrowserLogin.app.tar.zst`
- `production-macos-arm64-update.json`

Windows x64:

- `production-win-x64-BrowserLogin-Setup.zip`
- `production-win-x64-BrowserLogin.tar.zst`
- `production-win-x64-update.json`

Linux x64:

- `production-linux-x64-BrowserLogin-Setup.tar.gz`
- `production-linux-x64-BrowserLogin.tar.zst`
- `production-linux-x64-update.json`

The artifact archives were extracted and their native launchers were executed
with the smoke environment flag. Linux ran under `xvfb`; the Linux log also
confirmed GTK event-loop startup. No macOS x64, Linux arm64, MSI, AppImage, or
deb target was added.

## Updater Probe

The temporary release used tag/release `stable-spike` and was created only
from a locally built macOS arm64 `0.1.1` artifact. A locally built `0.1.0`
unsigned app used a temporary base URL ending in `/releases/download/stable-spike`.
The app-side probe invoked `Updater.checkForUpdate()` and
`Updater.downloadUpdate()` and emitted:

```json
{"updateAvailable":true,"updateReady":true}
```

This proves unsigned check and download on macOS arm64. The apply probe was
also attempted against the disposable app directory, but it did not produce a
reliable completion signal and left the child process active. It is therefore
classified BLOCKED, not PASS. Linux and Windows are BLOCKED for apply proof in
this spike because no installed native app probe was run on those runners.

Fallback UX selected for the real app:

1. Keep the update metadata check.
2. When the app reports an available update but unsigned apply is unavailable,
   display `Update available - download`.
3. Open the latest GitHub Release page rather than silently applying an update.

Cleanup proof:

```text
gh release delete stable-spike --yes --cleanup-tag
gh release view stable-spike -> release not found
gh api .../git/ref/tags/stable-spike -> 404 Not Found
```

No `stable` release was created or modified.

## Local Verification

- `hutch electrobun sync`: PASS.
- Local macOS arm64 unsigned build: PASS; generated DMG, app archive, and update metadata.
- Local packaged launcher smoke with `BROWSERLOGIN_SPIKE_SMOKE=1`: PASS.
- `bun run typecheck`: PASS after Hutch devkit sync and Bun type pin.
- `bun run lint`: blocked by generated `.hutch` SDK files being included in the scaffold's existing project-aware ESLint configuration; no Task 7 source lint error was observed separately.
- `bun run test`: unrelated concurrent Task 3 ONNX fixture assertion currently fails on an extra `log_std.max` field; Task 7 tests were not changed.
