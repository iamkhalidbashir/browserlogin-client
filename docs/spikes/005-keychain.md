# Spike 005: OS keychain shims

Status: pending native matrix dispatch.

## Decision

Use OS credential stores through subprocess shims. No native Node module, keytar package, plaintext file, environment-variable credential storage, or fallback credential store is authorized.

The adapter contract exposes exactly these errors:

```text
NOT_FOUND
BACKEND_UNAVAILABLE
LOCKED
DENIED
TIMEOUT
```

Linux without a usable Secret Service returns `BACKEND_UNAVAILABLE` with actionable remediation: install `libsecret-tools`, start a Secret Service provider such as GNOME Keyring or KeePassXC, and run with a user D-Bus session. `BROWSERLOGIN_API_KEY` remains an explicit caller-provided headless path; it is not a storage fallback. No credential is written to disk.

macOS or Windows round-trip failure is a stop condition. There is no pre-authorized fallback. Any failure other than the documented Linux unavailable case is also a stop condition.

## Encoding and leak boundary

The hostile test values contain a literal newline, Unicode, quotes, shell metacharacters, and a backslash. Each adapter receives a reversible versioned envelope:

```text
blv1:<base64-of-UTF8-secret>
```

The envelope is credential material. It is passed only through stdin, never argv or environment. The macOS prompt receives one envelope per line, each terminated by a newline; embedded secret newlines are therefore inside the base64 payload instead of becoming prompt delimiters. Retrieved output is decoded and byte-compared against the original UTF-8 bytes.

The runner scans raw and encoded values in process environment, argv, stderr, diagnostic stdout, and captured argv. Expected encoded retrieval transport is removed only for the internal comparison; it is never printed into the verdict, evidence, or logs. Evidence files are sanitized and contain neither form.

## Exact commands

Run locally with the pinned runtime:

```sh
bun scripts/spike-keychain.ts
```

macOS setup and cleanup commands:

```text
security create-keychain -p "" <temporary-keychain>
security unlock-keychain -p "" <temporary-keychain>
security default-keychain
security default-keychain -s <temporary-keychain>
```

The current macOS `security` CLI has an important parser constraint: prompt-only `-w` must be the final option and cannot be combined with a following keychain positional path. The adapter therefore invokes the prompt command through `/usr/bin/expect` with a non-secret `-c` script, while the throwaway keychain is temporarily selected as the default. This is not a credential fallback or a login-keychain mutation. The explicit-keychain operations are:

```text
security find-generic-password -s co.browserlogin.app -a bl_test_<random> -w <temporary-keychain>
security lock-keychain <temporary-keychain>
security unlock-keychain -p wrong <temporary-keychain>
security unlock-keychain -p "" <temporary-keychain>
security delete-generic-password -s co.browserlogin.app -a bl_test_<random> <temporary-keychain>
security delete-keychain <temporary-keychain>
```

`security` status 44 is treated as `NOT_FOUND`. A wrong-password unlock of the locked throwaway keychain returns status 51 on the observed macOS runner and is treated as `DENIED`. The original default keychain is restored in `finally`; the temporary keychain and directory are deleted, and the script verifies the directory is absent.

Linux commands, with the envelope on stdin:

```text
secret-tool store --label=BrowserLogin service co.browserlogin.app account bl_test_<random>
secret-tool lookup service co.browserlogin.app account bl_test_<random>
secret-tool clear service co.browserlogin.app account bl_test_<random>
```

Missing `secret-tool` is distinguished from an installed client whose Secret Service/D-Bus provider is unavailable. Both are `BACKEND_UNAVAILABLE`, with different remediation details.

Windows command line:

```text
powershell.exe -NoProfile -NonInteractive -Command -
```

The PowerShell source is one stdin line and the envelope is a separate second stdin line. The source constructs `Windows.Security.Credentials.PasswordVault`, stores through `PasswordCredential`, retrieves with `RetrievePassword()`, re-encodes retrieved bytes as `blv1:...`, and removes with `Remove()`. No source string contains the credential payload.

## Behavior matrix

`PASS` means exercised and exact. `SKIP` is an intentionally non-simulated provider state. Linux `BACKEND_UNAVAILABLE` is a valid green result.

| Behavior | macos-14 | windows-2025 | ubuntu-24.04 |
| --- | --- | --- | --- |
| store | PENDING | PENDING | PASS or BACKEND_UNAVAILABLE |
| retrieve hostile Unicode/newline/metacharacter bytes | PENDING | PENDING | PASS or BACKEND_UNAVAILABLE |
| replace | PENDING | PENDING | PASS or BACKEND_UNAVAILABLE |
| delete | PENDING | PENDING | PASS or BACKEND_UNAVAILABLE |
| not found | PENDING | PENDING | PASS or BACKEND_UNAVAILABLE |
| backend unavailable classification | PENDING | PENDING | PASS |
| locked/denied | PENDING; throwaway keychain only | PENDING | SKIP; provider-specific |
| cleanup proof | PENDING | N/A | N/A |
| leak scan: raw and encoded values | PENDING | PENDING | PENDING |

## Native matrix evidence

Workflow: `.github/workflows/spike-keychain.yml` (manual dispatch only).

CI run URL: `PENDING: replace after pushing and dispatching the workflow.`

Recorded results:

```text
macos-14: PENDING
windows-2025: PENDING
ubuntu-24.04: PENDING
```

Do not claim three-platform success without the real workflow URL and all three native job results.

## Official semantics checked

- Apple documents generic password add/find/delete behavior and Keychain Services status handling: <https://developer.apple.com/documentation/security/seckeychainaddgenericpassword(_:_:_:_:_:_:_:_:)> and <https://developer.apple.com/documentation/security/seckeychainunlock(_:_:_:_:)>.
- Ubuntu's `secret-tool` man page documents stdin-to-EOF storage, lookup, clear, and non-zero failure status: <https://manpages.ubuntu.com/manpages/noble/en/man1/secret-tool.1.html>.
- Microsoft documents `PasswordVault`, `PasswordCredential`, `Add`, `Retrieve`, `RetrievePassword`, and `Remove`: <https://learn.microsoft.com/en-us/windows/apps/develop/security/credential-locker> and <https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.passwordvault?view=winrt-28000>.
- Microsoft documents `-NoProfile`, `-NonInteractive`, and `-Command -` stdin source semantics: <https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe?view=powershell-5.1>.

## Stop/fallback outcomes

| Condition | Outcome |
| --- | --- |
| macOS `security` hostile round-trip fails | STOP and report; no fallback |
| Windows `PasswordVault` round-trip fails | STOP and report; no file fallback or authorization implied |
| Linux `secret-tool` absent | `BACKEND_UNAVAILABLE`; install `libsecret-tools`; use explicit `BROWSERLOGIN_API_KEY` path |
| Linux Secret Service/D-Bus unavailable | `BACKEND_UNAVAILABLE`; start a provider and user D-Bus session; use explicit env path |
| Any other failure | STOP and report |
