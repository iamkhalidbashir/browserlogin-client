import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeSecret, encodeSecret } from "../../src/core/keychain";
import { MacOSKeychainBackend } from "../../src/core/keychain/macos";
import {
  buildWindowsPowerShellFrame,
  WindowsKeychainBackend,
} from "../../src/core/keychain/windows";
import { KeychainError } from "../../src/shared/errors";
import {
  KEYCHAIN_API_ACCOUNT,
  KEYCHAIN_SERVICE,
} from "../../src/shared/keychain-types";
import type { KeychainServiceAccount } from "../../src/shared/keychain-types";

const secret = `quote'\nümlaut $()\\ <>&`;
const realEnabled = process.env.BROWSERLOGIN_REAL_KEYCHAIN === "1";
const currentNativeOs =
  process.platform === "darwin" || process.platform === "win32";

function runPowerShellParser(source: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "-"],
      {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on(
      "data",
      (chunk: Buffer) => (stdout += chunk.toString("utf8")),
    );
    child.stderr.on(
      "data",
      (chunk: Buffer) => (stderr += chunk.toString("utf8")),
    );
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.replace(/\r?\n/g, " ").slice(0, 500)));
    });
    child.stdin.end(source);
  });
}

describe("real keychain integration", () => {
  it.skipIf(process.platform !== "win32")(
    "PowerShell parses store/get/delete frames with source-first stdin",
    async () => {
      const key = {
        service: KEYCHAIN_SERVICE,
        account: `${KEYCHAIN_API_ACCOUNT}-${randomUUID()}`,
      } as unknown as KeychainServiceAccount;
      const envelope = encodeSecret(secret);
      for (const operation of ["set", "get", "delete"] as const) {
        const frame = buildWindowsPowerShellFrame(operation, key, envelope);
        const parser = `$candidate = @'\n${frame}'@\n$tokens = $null\n$errors = $null\n[System.Management.Automation.Language.Parser]::ParseInput($candidate, [ref]$tokens, [ref]$errors) | Out-Null\nif ($errors.Count -ne 0) { exit 1 }\nif (-not $candidate.StartsWith('$payload =')) { exit 2 }\nWrite-Output parsed`;
        await expect(runPowerShellParser(parser)).resolves.toBe("parsed");
        expect(frame.startsWith("$payload = ")).toBe(true);
        expect(frame).not.toContain(secret);
      }
    },
  );

  it.skipIf(!realEnabled || !currentNativeOs)(
    "round-trips and cleans a hostile secret on the current native OS",
    async () => {
      const key = {
        service: KEYCHAIN_SERVICE,
        account: `${KEYCHAIN_API_ACCOUNT}-${randomUUID()}`,
      } as unknown as KeychainServiceAccount;
      const backend =
        process.platform === "darwin"
          ? new MacOSKeychainBackend()
          : new WindowsKeychainBackend();
      try {
        await backend.set(key, secret);
        await expect(backend.get(key)).resolves.toBe(secret);
      } finally {
        await backend.delete(key).catch((error) => {
          if (
            !(error instanceof KeychainError) ||
            error.keychain_code !== "NOT_FOUND"
          )
            throw error;
        });
      }
    },
    15_000,
  );

  it("keeps the retrieved envelope internal to the adapter contract", () => {
    const envelope = encodeSecret(secret);
    expect(decodeSecret(`${envelope}\n`)).toBe(secret);
    expect(envelope).not.toContain(secret);
  });
});
