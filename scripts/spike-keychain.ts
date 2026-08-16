#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export enum KeychainError {
  NOT_FOUND = "NOT_FOUND",
  BACKEND_UNAVAILABLE = "BACKEND_UNAVAILABLE",
  LOCKED = "LOCKED",
  DENIED = "DENIED",
  TIMEOUT = "TIMEOUT",
}

type RunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  argv: string[];
};

type Cell = {
  status: "PASS" | "FAIL" | "SKIP";
  error?: KeychainError;
  detail?: string;
};

type Matrix = Record<string, Cell>;
type InputChunk = { data: string; delayMs?: number };

const resource = "co.browserlogin.app";
const account = `bl_test_${randomBytes(8).toString("hex")}`;
const secret = `pa ss\"word'\n$()\\ümlaut`;
const replacement = `replace\n${randomBytes(5).toString("hex")}<>|`;
const timeoutMs = 15_000;
const rawSecrets = [secret, replacement];
const envelopes = rawSecrets.map((value) => `blv1:${Buffer.from(value, "utf8").toString("base64")}`);
const childRuns: RunResult[] = [];
let macCleanupProof = false;

function hasCredentialMaterial(value: string): boolean {
  return rawSecrets.some((secretValue) => value.includes(secretValue)) || envelopes.some((envelope) => value.includes(envelope));
}

function assertNoCredentialMaterial(value: string, where: string): void {
  if (hasCredentialMaterial(value)) throw new Error(`credential material leak detected in ${where}`);
}

function stripExpectedTransport(value: string): string {
  return envelopes.reduce((result, envelope) => result.split(envelope).join(""), value);
}

function classifyFailure(result: RunResult): KeychainError | undefined {
  if (result.code === null && result.signal === "SIGTERM") return KeychainError.TIMEOUT;
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (/no matching|could not be found|not found|no such item|element not found|does not exist/.test(text)) return KeychainError.NOT_FOUND;
  if (/locked|interaction is required|user interaction|authentication required/.test(text)) return KeychainError.LOCKED;
  if (/permission denied|access denied|unauthori[sz]ed|not permitted|operation not permitted|passphrase .*not correct/.test(text)) return KeychainError.DENIED;
  if (/command not found|no such file|cannot autolaunch|secret service|dbus|passwordvault|windows\.security\.credentials|winrt/.test(text)) return KeychainError.BACKEND_UNAVAILABLE;
  return undefined;
}

async function runWindowsProcess(command: string, args: string[], chunks: InputChunk[], expectedTransport: boolean): Promise<RunResult> {
  const argv = [command, ...args];
  argv.forEach((arg) => assertNoCredentialMaterial(arg, `${command} argv`));
  const input = chunks.map((chunk) => chunk.data).join("");
  const child = Bun.spawnSync({ cmd: argv, stdin: Buffer.from(input, "utf8"), stdout: "pipe", stderr: "pipe", maxBuffer: 1024 * 1024 });
  const stdout = child.stdout?.toString("utf8") ?? "";
  const stderr = child.stderr?.toString("utf8") ?? "";
  const result: RunResult = { code: child.exitCode, signal: null, stdout, stderr, argv };
  assertNoCredentialMaterial(expectedTransport ? stripExpectedTransport(stdout) : stdout, `${command} stdout`);
  assertNoCredentialMaterial(expectedTransport ? stripExpectedTransport(stderr) : stderr, `${command} stderr`);
  childRuns.push(result);
  return result;
}

function run(command: string, args: string[], chunks: InputChunk[] = [], expectedTransport = false): Promise<RunResult> {
  for (const arg of args) assertNoCredentialMaterial(arg, `${command} argv`);
  if (process.platform === "win32" && /(?:^|[\\/])(?:powershell|pwsh)(?:\.exe)?$/i.test(command)) {
    return runWindowsProcess(command, args, chunks, expectedTransport);
  }
  const child = spawn(command, args, { shell: false, stdio: ["pipe", "pipe", "pipe"] });
  const result = new Promise<RunResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      assertNoCredentialMaterial(expectedTransport ? stripExpectedTransport(stdout) : stdout, `${command} stdout`);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      assertNoCredentialMaterial(expectedTransport ? stripExpectedTransport(stderr) : stderr, `${command} stderr`);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        resolve({ code: 127, signal: null, stdout, stderr: "command not found", argv: [command, ...args] });
      } else {
        reject(error);
      }
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ code, signal, stdout, stderr, argv: [command, ...args] });
    });
  });
  void (async () => {
    for (const chunk of chunks) {
      if (chunk.delayMs) await Bun.sleep(chunk.delayMs);
      child.stdin.write(chunk.data);
    }
    child.stdin.end();
  })();
  return result.then((value) => {
    assertNoCredentialMaterial(JSON.stringify(value.argv), `${command} captured argv`);
    assertNoCredentialMaterial(expectedTransport ? stripExpectedTransport(value.stderr) : value.stderr, `${command} captured stderr`);
    assertNoCredentialMaterial(expectedTransport ? stripExpectedTransport(value.stdout) : value.stdout, `${command} captured stdout`);
    childRuns.push(value);
    return value;
  });
}

async function exists(command: string): Promise<boolean> {
  const checker = process.platform === "win32" ? "where.exe" : "which";
  return (await run(checker, [command])).code === 0;
}

function pass(): Cell {
  return { status: "PASS" };
}

function skip(detail: string): Cell {
  return { status: "SKIP", detail };
}

function fail(error: KeychainError | undefined, detail: string): Cell {
  return { status: "FAIL", ...(error ? { error } : {}), detail };
}

function failureDetail(prefix: string, result: RunResult): string {
  const diagnostic = stripExpectedTransport(`${result.stderr}\n${result.stdout}`).trim().replace(/\s+/g, " ").slice(0, 240);
  assertNoCredentialMaterial(diagnostic, "failure diagnostic");
  const shape = `stdout-length=${result.stdout.length},stdout-codes=${[...result.stdout.slice(0, 4)].map((char) => char.charCodeAt(0)).join(".")}`;
  return `${prefix} (exit=${result.code ?? result.signal ?? "unknown"}; ${shape}${diagnostic ? `: ${diagnostic}` : ""})`;
}

function successful(result: RunResult): boolean {
  return result.code === 0;
}

function decodeEnvelope(value: string): string | undefined {
  const line = value.replace(/\r?\n$/, "");
  if (!line.startsWith("blv1:")) return undefined;
  return Buffer.from(line.slice(5), "base64").toString("utf8");
}

function expectSource(operation: "store" | "replace", accountName: string, serviceName: string): string {
  const accountLiteral = JSON.stringify(accountName);
  const serviceLiteral = JSON.stringify(serviceName);
  return `set timeout 10; set first [gets stdin]; set second [gets stdin]; spawn /usr/bin/security add-generic-password -s ${serviceLiteral} -a ${accountLiteral} ${operation === "replace" ? "-U " : ""}-w; expect "password data for new item:"; send -- "$first\\r"; expect "retype password for new item:"; send -- "$second\\r"; expect eof`;
}

async function macStore(envelope: string, operation: "store" | "replace"): Promise<RunResult> {
  return run("/usr/bin/expect", ["-c", expectSource(operation, account, resource)], [
    { data: `${envelope}\n`, delayMs: 100 },
    { data: `${envelope}\n`, delayMs: 100 },
  ], true);
}

async function runMac(): Promise<{ matrix: Matrix; available: boolean; cleanup: boolean }> {
  const matrix: Matrix = {};
  if (process.platform !== "darwin") return { matrix: { platform: skip("not macOS") }, available: false, cleanup: true };
  if (!(await exists("security")) || !(await exists("expect"))) {
    matrix.backend_unavailable = fail(KeychainError.BACKEND_UNAVAILABLE, "security or expect is missing");
    return { matrix, available: false, cleanup: true };
  }

  const directory = await mkdtemp(join(tmpdir(), "bl-keychain-"));
  const keychain = join(directory, "throwaway.keychain-db");
  let originalDefault = "";
  let cleanup = false;
  try {
    let result = await run("security", ["create-keychain", "-p", "", keychain]);
    if (!successful(result)) return { matrix: { setup: fail(classifyFailure(result), "temporary keychain creation failed") }, available: false, cleanup };
    result = await run("security", ["unlock-keychain", "-p", "", keychain]);
    if (!successful(result)) return { matrix: { setup: fail(classifyFailure(result), "temporary keychain unlock failed") }, available: false, cleanup };
    result = await run("security", ["default-keychain"]);
    originalDefault = result.stdout.trim().replace(/^"|"$/g, "");
    result = await run("security", ["default-keychain", "-s", keychain]);
    if (!successful(result)) return { matrix: { setup: fail(classifyFailure(result), "temporary default-keychain selection failed") }, available: false, cleanup };

    result = await macStore(envelopes[0], "store");
    matrix.store = successful(result) ? pass() : fail(classifyFailure(result), "stdin envelope store failed");
    result = await run("security", ["find-generic-password", "-s", resource, "-a", account, "-w", keychain], [], true);
    const stored = decodeEnvelope(result.stdout);
    matrix.retrieve = successful(result) && stored === secret ? pass() : fail(classifyFailure(result), "retrieved envelope did not decode to the original bytes");

    result = await macStore(envelopes[1], "replace");
    result = successful(result) ? await run("security", ["find-generic-password", "-s", resource, "-a", account, "-w", keychain], [], true) : result;
    matrix.replace = successful(result) && decodeEnvelope(result.stdout) === replacement ? pass() : fail(classifyFailure(result), "replacement envelope did not decode to the replacement bytes");

    result = await run("security", ["lock-keychain", keychain]);
    if (successful(result)) {
      result = await run("security", ["unlock-keychain", "-p", "wrong", keychain]);
      const error = result.code === 51 ? KeychainError.DENIED : classifyFailure(result);
      matrix.locked_or_denied = error === KeychainError.LOCKED || error === KeychainError.DENIED ? pass() : fail(error, "throwaway locked-keychain probe was not deterministically classified");
      await run("security", ["unlock-keychain", "-p", "", keychain]);
    } else {
      matrix.locked_or_denied = fail(classifyFailure(result), "throwaway keychain lock failed");
    }

    result = await run("security", ["delete-generic-password", "-s", resource, "-a", account, keychain]);
    matrix.delete = successful(result) ? pass() : fail(classifyFailure(result), "explicit-keychain delete failed");
    result = await run("security", ["find-generic-password", "-s", resource, "-a", account, "-w", keychain], [], true);
    matrix.not_found = result.code === 44 ? pass() : fail(classifyFailure(result), "missing item did not return security status 44");
    matrix.backend_unavailable = skip("security and expect are available");
    return { matrix, available: Object.values(matrix).every((cell) => cell.status !== "FAIL"), cleanup };
  } finally {
    if (originalDefault) await run("security", ["default-keychain", "-s", originalDefault]).catch(() => undefined);
    await run("security", ["delete-keychain", keychain]).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
    try {
      await access(directory);
    } catch {
      cleanup = true;
    }
    macCleanupProof = cleanup;
  }
}

async function runLinux(): Promise<{ matrix: Matrix; available: boolean }> {
  const matrix: Matrix = {};
  if (process.platform !== "linux") return { matrix: { platform: skip("not Linux") }, available: false };
  if (!(await exists("secret-tool"))) {
    matrix.store = fail(KeychainError.BACKEND_UNAVAILABLE, "secret-tool is missing");
    matrix.backend_unavailable = pass();
    matrix.remediation = pass();
    return { matrix, available: true };
  }
  const attributes = ["service", resource, "account", account];
  let result = await run("secret-tool", ["store", "--label=BrowserLogin", ...attributes], [{ data: `${envelopes[0]}\n` }]);
  const backendError = classifyFailure(result);
  if (!successful(result)) {
    matrix.store = fail(backendError ?? KeychainError.BACKEND_UNAVAILABLE, "Secret Service is unavailable; use a user D-Bus session and provider");
    matrix.backend_unavailable = backendError === KeychainError.BACKEND_UNAVAILABLE ? pass() : fail(backendError, "Secret Service failure was not classified as BACKEND_UNAVAILABLE");
    matrix.remediation = pass();
    return { matrix, available: true };
  }
  matrix.store = pass();
  result = await run("secret-tool", ["lookup", ...attributes], [], true);
  matrix.retrieve = successful(result) && decodeEnvelope(result.stdout) === secret ? pass() : fail(classifyFailure(result), "retrieved envelope did not decode to the original bytes");
  result = await run("secret-tool", ["store", "--label=BrowserLogin", ...attributes], [{ data: `${envelopes[1]}\n` }]);
  result = successful(result) ? await run("secret-tool", ["lookup", ...attributes], [], true) : result;
  matrix.replace = successful(result) && decodeEnvelope(result.stdout) === replacement ? pass() : fail(classifyFailure(result), "replacement envelope did not decode to replacement bytes");
  result = await run("secret-tool", ["clear", ...attributes]);
  matrix.delete = successful(result) ? pass() : fail(classifyFailure(result), "Secret Service clear failed");
  result = await run("secret-tool", ["lookup", ...attributes], [], true);
  matrix.not_found = result.code !== 0 && !classifyFailure(result) ? pass() : fail(classifyFailure(result), "missing item did not return a non-zero not-found result");
  matrix.locked_or_denied = skip("Secret Service lock policy is provider-specific");
  matrix.backend_unavailable = skip("Secret Service was available");
  return { matrix, available: true };
}

function powershellSource(operation: "store" | "retrieve" | "remove", accountName: string, resourceName: string, envelope: string): string {
  const accountLiteral = JSON.stringify(accountName);
  const resourceLiteral = JSON.stringify(resourceName);
  const action = operation === "store"
    ? `try { $old = $vault.Retrieve($resource, $account); $vault.Remove($old) } catch {}; $secret = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($envelope.Substring(5))); $credential = New-Object Windows.Security.Credentials.PasswordCredential -ArgumentList $resource,$account,$secret; $vault.Add($credential)`
    : operation === "retrieve"
      ? `$credential = $vault.Retrieve($resource, $account); $credential.RetrievePassword(); if ($null -eq $credential.Password) { throw "PasswordVault returned a null password" }; $encoded = "blv1:" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($credential.Password)); [Console]::WriteLine($encoded)`
      : `$credential = $vault.Retrieve($resource, $account); $vault.Remove($credential)`;
  const retrieveTransport = operation === "retrieve" ? "[Console]::Error.WriteLine($encoded)" : "";
  return `$envelope = @'\n${envelope}\n'@\nAdd-Type -AssemblyName System.Runtime.WindowsRuntime; $null = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]; $vault = New-Object Windows.Security.Credentials.PasswordVault; $resource = ${resourceLiteral}; $account = ${accountLiteral}; try { ${action.replace("[Console]::WriteLine($encoded)", retrieveTransport)} } catch { [Console]::Error.WriteLine($_.Exception.GetType().FullName); [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
}

async function runWindows(): Promise<{ matrix: Matrix; available: boolean }> {
  const matrix: Matrix = {};
  if (process.platform !== "win32") return { matrix: { platform: skip("not Windows") }, available: false };
  const powershell = (await exists("powershell.exe")) ? "powershell.exe" : (await exists("pwsh.exe")) ? "pwsh.exe" : undefined;
  if (!powershell) return { matrix: { backend_unavailable: fail(KeychainError.BACKEND_UNAVAILABLE, "PowerShell is missing") }, available: true };
  const transportProbe = await run(powershell, ["-NoProfile", "-NonInteractive", "-Command", "-"], [{ data: "Write-Output bun-powershell-probe\n" }]);
  matrix.transport_probe = transportProbe.stdout.includes("bun-powershell-probe") ? pass() : fail(KeychainError.BACKEND_UNAVAILABLE, `Bun PowerShell stdout capture failed (stdout=${transportProbe.stdout.length}, stderr=${transportProbe.stderr.length})`);
  const invoke = (operation: "store" | "retrieve" | "remove", envelope = "") => run(powershell, ["-NoProfile", "-NonInteractive", "-Command", "-"], [{ data: `${powershellSource(operation, account, resource, envelope)}\n` }], operation === "retrieve");
  let result = await invoke("store", envelopes[0]);
  matrix.store = successful(result) ? pass() : fail(classifyFailure(result), failureDetail("PasswordVault store failed", result));
  result = await invoke("retrieve", envelopes[0]);
  matrix.retrieve = successful(result) && decodeEnvelope(result.stdout || result.stderr) === secret ? pass() : fail(classifyFailure(result), failureDetail("PasswordVault retrieval did not decode to original bytes", result));
  result = await invoke("store", envelopes[1]);
  result = successful(result) ? await invoke("retrieve", envelopes[1]) : result;
  matrix.replace = successful(result) && decodeEnvelope(result.stdout || result.stderr) === replacement ? pass() : fail(classifyFailure(result), failureDetail("PasswordVault replacement did not decode to replacement bytes", result));
  result = await invoke("remove", envelopes[1]);
  matrix.delete = successful(result) ? pass() : fail(classifyFailure(result), failureDetail("PasswordVault remove failed", result));
  result = await invoke("retrieve", envelopes[1]);
  matrix.not_found = classifyFailure(result) === KeychainError.NOT_FOUND ? pass() : fail(classifyFailure(result), failureDetail("PasswordVault missing item was not NOT_FOUND", result));
  matrix.locked_or_denied = skip("PasswordVault lock state is provider-owned and not safely simulated");
  matrix.backend_unavailable = skip("PasswordVault was available");
  return { matrix, available: Object.values(matrix).every((cell) => cell.status !== "FAIL") };
}

async function main(): Promise<void> {
  for (const [name, value] of Object.entries(process.env)) assertNoCredentialMaterial(`${name}=${value ?? ""}`, "environment");
  const [mac, linux, windows] = await Promise.all([runMac(), runLinux(), runWindows()]);
  for (const child of childRuns) {
    assertNoCredentialMaterial(JSON.stringify(child.argv), "captured argv");
    assertNoCredentialMaterial(child.stderr, "captured stderr");
    assertNoCredentialMaterial(stripExpectedTransport(child.stdout), "captured stdout");
    assertNoCredentialMaterial(stripExpectedTransport(child.stderr), "captured stderr");
  }
  const verdict = {
    platform: process.platform,
    account,
    stdin_only: true,
    envelope_version: "blv1",
    errors: Object.values(KeychainError),
    macos: mac.matrix,
    linux: linux.matrix,
    windows: windows.matrix,
    cleanup: process.platform === "darwin" ? macCleanupProof : true,
    leak_scan: "PASS",
  };
  console.log(JSON.stringify(verdict, null, 2));
  if ((process.platform === "darwin" && !mac.available) || (process.platform === "win32" && !windows.available)) process.exitCode = 1;
}

await main();
