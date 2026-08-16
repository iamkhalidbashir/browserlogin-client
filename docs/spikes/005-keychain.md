# Spike 005: OS keychain shims

Status: complete after native matrix run `31925101839`.

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

macOS setup and cleanup commands (the disposable keychain password is the user-authorized test-only value `pass1234`):

```text
security create-keychain -p pass1234 <temporary-keychain>
security unlock-keychain -p pass1234 <temporary-keychain>
security lock-keychain <temporary-keychain>
security unlock-keychain -p pass1234 <temporary-keychain>
security delete-keychain <temporary-keychain>
```

The current macOS `security` CLI cannot combine prompt-only `-w` with a following keychain positional path. To keep every credential operation explicitly addressed without changing any default/search-list state, the spike compiles a temporary Swift Security-framework helper from stdin. The helper receives only the operation, temporary keychain path, service, and randomized account in argv; the BrowserLogin envelope is stdin-only. It calls the explicit-keychain Security APIs for add, find, replace, and delete, and disables Security-framework UI interaction in its own process.

```text
swiftc -framework Security -o <temporary-helper> -
<temporary-helper> store <temporary-keychain> co.browserlogin.app bl_test_<random>
<temporary-helper> retrieve <temporary-keychain> co.browserlogin.app bl_test_<random>
<temporary-helper> replace <temporary-keychain> co.browserlogin.app bl_test_<random>
<temporary-helper> delete <temporary-keychain> co.browserlogin.app bl_test_<random>
```

The helper uses `SecKeychainOpen` with the explicit path for every generic-password operation. `SecKeychainSetUserInteractionAllowed(false)` prevents GUI/password prompts. A locked explicit lookup returns `errSecInteractionNotAllowed` and maps to `LOCKED`; item absence maps to `NOT_FOUND`. The temporary keychain and directory are deleted in `finally`, and the script verifies the directory is absent. No default keychain or search-list command is invoked.

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

The PowerShell stdin frame begins with a separate payload-assignment line containing the `blv1:` envelope, followed by the operation source. The source constructs `Windows.Security.Credentials.PasswordVault`, stores through `PasswordCredential`, retrieves with `RetrievePassword()`, re-encodes retrieved bytes as `blv1:...`, and removes with `Remove()`. No payload is placed in argv or environment.

## Behavior matrix

`PASS` means exercised and exact. `SKIP` is an intentionally non-simulated provider state. Linux `BACKEND_UNAVAILABLE` is a valid green result.

| Behavior | macos-14 | windows-2025 | ubuntu-24.04 |
| --- | --- | --- | --- |
| store | PASS | PASS | BACKEND_UNAVAILABLE (missing `secret-tool`) |
| retrieve hostile Unicode/newline/metacharacter bytes | PASS | PASS | BACKEND_UNAVAILABLE (missing `secret-tool`) |
| replace | PASS | PASS | BACKEND_UNAVAILABLE (missing `secret-tool`) |
| delete | PASS | PASS | BACKEND_UNAVAILABLE (missing `secret-tool`) |
| not found | PASS | PASS | BACKEND_UNAVAILABLE (missing `secret-tool`) |
| backend unavailable classification | PASS | PASS | PASS |
| locked/denied | PASS; explicit throwaway lookup | SKIP; provider-owned | SKIP; provider-specific |
| cleanup proof | PASS locally | N/A | N/A |
| leak scan: raw and encoded values | PASS | PASS | PASS |

## Native matrix evidence

Workflow: `.github/workflows/spike-keychain.yml` (manual dispatch only).

CI run URL: <https://github.com/iamkhalidbashir/browserlogin-client/actions/runs/31925101839>

Recorded results:

```text
macos-14: PASS; cleanup=true; leak_scan=PASS
windows-2025: PASS; PasswordVault store/retrieve/replace/delete/not-found=PASS; leak_scan=PASS
ubuntu-24.04: PASS under documented unavailable contract; `secret-tool` missing, `BACKEND_UNAVAILABLE` and remediation=PASS; leak_scan=PASS
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
