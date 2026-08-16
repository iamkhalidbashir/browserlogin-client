import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { KeychainError } from "../../shared/errors";
import {
  KEYCHAIN_API_ACCOUNT,
  KEYCHAIN_LICENSE_ACCOUNT,
  KEYCHAIN_SERVICE,
} from "../../shared/keychain-types";
import type {
  KeychainBackend,
  KeychainServiceAccount,
} from "../../shared/keychain-types";
import { LinuxKeychainBackend } from "./linux";
import { MacOSKeychainBackend } from "./macos";
import { WindowsKeychainBackend } from "./windows";

export const KEYCHAIN_TIMEOUT_MS = 5_000;

export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export type KeychainOptions = {
  spawn?: SpawnLike;
  timeoutMs?: number;
};

export type CommandResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

const defaultSpawn: SpawnLike = (command, args, options) =>
  spawn(command, args, options);

export function encodeSecret(secret: string): string {
  return `blv1:${Buffer.from(secret, "utf8").toString("base64")}`;
}

export function decodeSecret(value: string): string {
  const line = value.trimEnd().replace(/\r?\n$/, "");
  if (!line.startsWith("blv1:"))
    throw new KeychainError(
      "BACKEND_UNAVAILABLE",
      "Keychain returned an invalid secret envelope",
    );
  try {
    return Buffer.from(line.slice(5), "base64").toString("utf8");
  } catch (error) {
    throw new KeychainError(
      "BACKEND_UNAVAILABLE",
      "Keychain returned an invalid secret envelope",
      { cause: error },
    );
  }
}

function scrub(value: string, envelope?: string): string {
  let result = value;
  if (envelope) {
    result = result.split(envelope).join("<credential>");
    try {
      result = result.split(decodeSecret(envelope)).join("<credential>");
    } catch (error) {
      void error;
    }
  }
  return result
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 500);
}

function classify(
  result: Pick<CommandResult, "code" | "signal" | "stdout" | "stderr">,
  commandMissing = false,
): KeychainError["keychain_code"] {
  if (result.signal === "SIGTERM" || result.signal === "SIGKILL")
    return "TIMEOUT";
  if (result.code === 44) return "NOT_FOUND";
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (commandMissing || /command not found|no such file/.test(text))
    return "BACKEND_UNAVAILABLE";
  if (
    /status=-25300\b|not found|no such item|no matching|does not exist|element not found/.test(
      text,
    )
  )
    return "NOT_FOUND";
  if (
    /status=-25308\b|status=45\b|locked|interaction required|user interaction|authentication required/.test(
      text,
    )
  )
    return "LOCKED";
  if (
    /status=-25293\b|status=46\b|permission denied|access denied|unauthori[sz]ed|not permitted|operation not permitted|denied/.test(
      text,
    )
  )
    return "DENIED";
  if (
    /secret service|dbus|cannot autolaunch|passwordvault|windows\.security\.credentials|winrt/.test(
      text,
    )
  )
    return "BACKEND_UNAVAILABLE";
  return result.code === 0 ? "BACKEND_UNAVAILABLE" : "BACKEND_UNAVAILABLE";
}

export async function runKeychainCommand(
  command: string,
  args: readonly string[],
  input: string,
  options: KeychainOptions = {},
  envelope?: string,
): Promise<CommandResult> {
  let child: ChildProcess;
  try {
    child = (options.spawn ?? defaultSpawn)(command, args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    return {
      code: null,
      signal: null,
      stdout: "",
      stderr:
        error instanceof Error && "code" in error && error.code === "ENOENT"
          ? "command not found"
          : error instanceof Error
            ? scrub(error.message)
            : "command failed",
    };
  }
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 100);
    }, options.timeoutMs ?? KEYCHAIN_TIMEOUT_MS);
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      resolve({
        code: timedOut ? null : code,
        signal: timedOut ? "SIGTERM" : signal,
        stdout: scrub(stdout, envelope),
        stderr: scrub(stderr, envelope),
      });
    };
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      stderr = error.code === "ENOENT" ? "command not found" : error.message;
      finish(null, null);
    });
    child.once("close", (code, signal) => finish(code, signal));
    child.stdin?.end(input);
  });
}

export function keychainErrorFromResult(
  result: CommandResult,
  commandMissing = false,
): KeychainError {
  return new KeychainError(
    classify(result, commandMissing),
    `Keychain backend operation failed (${classify(result, commandMissing)})${
      result.stderr ? `: ${result.stderr}` : ""
    }`,
  );
}

export function assertKeychainKey(key: KeychainServiceAccount): void {
  if (
    key.service !== KEYCHAIN_SERVICE ||
    (key.account !== KEYCHAIN_API_ACCOUNT &&
      key.account !== KEYCHAIN_LICENSE_ACCOUNT)
  ) {
    throw new KeychainError(
      "DENIED",
      "Unsupported keychain service or account",
    );
  }
}

export class KeychainFacade implements KeychainBackend {
  constructor(private readonly backend: KeychainBackend) {}

  get(key: KeychainServiceAccount): Promise<string | null> {
    assertKeychainKey(key);
    return this.backend.get(key);
  }

  set(key: KeychainServiceAccount, secret: string): Promise<void> {
    assertKeychainKey(key);
    return this.backend.set(key, secret);
  }

  delete(key: KeychainServiceAccount): Promise<void> {
    assertKeychainKey(key);
    return this.backend.delete(key);
  }

  getApiKey(): Promise<string | null> {
    return this.get({
      service: KEYCHAIN_SERVICE,
      account: KEYCHAIN_API_ACCOUNT,
    });
  }

  setApiKey(secret: string): Promise<void> {
    return this.set(
      { service: KEYCHAIN_SERVICE, account: KEYCHAIN_API_ACCOUNT },
      secret,
    );
  }

  getLicenseKey(): Promise<string | null> {
    return this.get({
      service: KEYCHAIN_SERVICE,
      account: KEYCHAIN_LICENSE_ACCOUNT,
    });
  }

  setLicenseKey(secret: string): Promise<void> {
    return this.set(
      { service: KEYCHAIN_SERVICE, account: KEYCHAIN_LICENSE_ACCOUNT },
      secret,
    );
  }

  async clear(): Promise<void> {
    await Promise.all([
      this.delete({ service: KEYCHAIN_SERVICE, account: KEYCHAIN_API_ACCOUNT }),
      this.delete({
        service: KEYCHAIN_SERVICE,
        account: KEYCHAIN_LICENSE_ACCOUNT,
      }),
    ]);
  }
}

export function createKeychainBackend(
  platform: NodeJS.Platform = process.platform,
  options: KeychainOptions = {},
): KeychainFacade {
  const backend =
    platform === "darwin"
      ? new MacOSKeychainBackend(options)
      : platform === "win32"
        ? new WindowsKeychainBackend(options)
        : new LinuxKeychainBackend(options);
  return new KeychainFacade(backend);
}

export { LinuxKeychainBackend } from "./linux";
export { MacOSKeychainBackend } from "./macos";
export { WindowsKeychainBackend } from "./windows";
