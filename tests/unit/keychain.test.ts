import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  KeychainFacade,
  createKeychainBackend,
  decodeSecret,
  encodeSecret,
  type SpawnLike,
} from "../../src/core/keychain";
import { LinuxKeychainBackend } from "../../src/core/keychain/linux";
import { MacOSKeychainBackend } from "../../src/core/keychain/macos";
import { WindowsKeychainBackend } from "../../src/core/keychain/windows";
import { buildWindowsPowerShellFrame } from "../../src/core/keychain/windows";
import { KeychainError } from "../../src/shared/errors";
import {
  KEYCHAIN_API_ACCOUNT,
  KEYCHAIN_SERVICE,
} from "../../src/shared/keychain-types";

const key = {
  service: KEYCHAIN_SERVICE,
  account: KEYCHAIN_API_ACCOUNT,
} as const;
const secret = `quote'\nümlaut $()\\ <>&`;

type MockChild = EventEmitter & {
  stdin: Writable;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: (signal?: NodeJS.Signals) => boolean;
};

function mockSpawn(result: {
  output?: string;
  code?: number | null;
  stderr?: string;
  delay?: number;
  capture?: (command: string, args: readonly string[], input: string) => void;
}): SpawnLike {
  return (command, args) => {
    const child = new EventEmitter() as MockChild;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let input = "";
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        input += chunk.toString();
        callback();
      },
      final(callback) {
        result.capture?.(command, args, input);
        setTimeout(() => {
          if (result.output) child.stdout.end(result.output);
          else child.stdout.end();
          if (result.stderr) child.stderr.end(result.stderr);
          else child.stderr.end();
          child.emit(
            "close",
            result.code === undefined ? 0 : result.code,
            null,
          );
        }, result.delay ?? 0);
        callback();
      },
    });
    child.kill = (signal = "SIGTERM") => {
      child.emit("close", null, signal);
      return true;
    };
    return child as unknown as ChildProcess;
  };
}

function backendFor(type: "macos" | "linux" | "windows", spawn: SpawnLike) {
  const options = { spawn };
  return type === "macos"
    ? new MacOSKeychainBackend(options)
    : type === "windows"
      ? new WindowsKeychainBackend(options)
      : new LinuxKeychainBackend(options);
}

describe("keychain transport contract", () => {
  it.each(["macos", "linux", "windows"] as const)(
    "uses stdin-only envelope transport for %s",
    async (type) => {
      const calls: Array<{
        command: string;
        args: readonly string[];
        input: string;
      }> = [];
      const envelope = encodeSecret(secret);
      const backend = backendFor(
        type,
        mockSpawn({
          output:
            type === "macos" || type === "linux" || type === "windows"
              ? `${envelope}\n`
              : undefined,
          capture: (command, args, input) =>
            calls.push({ command, args, input }),
        }),
      );
      await backend.set(key, secret);
      expect(await backend.get(key)).toBe(secret);
      await backend.delete(key);
      expect(calls.length).toBe(type === "macos" ? 6 : 3);
      for (const call of calls) {
        expect(call.args.join(" ")).not.toContain(secret);
        expect(call.args.join(" ")).not.toContain(envelope);
        expect(call.input).not.toContain(secret);
      }
      expect(calls.some((call) => call.input.includes(envelope))).toBe(true);
      expect(calls.every((call) => call.command !== "sh")).toBe(true);
      if (type === "windows") {
        expect(calls[0]?.input.startsWith("$payload = ")).toBe(true);
        expect(calls[0]?.input.startsWith(`${envelope}\n`)).toBe(false);
      }
    },
  );

  it("starts Windows stdin with valid PowerShell source, not a bare envelope", () => {
    const envelope = encodeSecret(secret);
    const frame = buildWindowsPowerShellFrame("set", key, envelope);
    expect(frame.startsWith("$payload = ")).toBe(true);
    expect(frame.startsWith(`${envelope}\n`)).toBe(false);
    expect(frame).toContain(envelope);
    expect(frame).not.toContain(secret);
  });

  it("maps Linux missing secret-tool to actionable backend unavailability", async () => {
    const backend = new LinuxKeychainBackend({
      spawn: mockSpawn({ code: null, stderr: "command not found" }),
    });
    await expect(backend.get(key)).rejects.toMatchObject({
      keychain_code: "BACKEND_UNAVAILABLE",
      message: expect.stringContaining("install libsecret-tools"),
    });
  });

  it("maps deterministic error codes", async () => {
    for (const [stderr, code] of [
      ["no such item", "NOT_FOUND"],
      ["Secret Service is unavailable", "BACKEND_UNAVAILABLE"],
      ["keychain is locked", "LOCKED"],
      ["permission denied", "DENIED"],
    ] as const) {
      const backend = new LinuxKeychainBackend({
        spawn: mockSpawn({ code: 1, stderr }),
      });
      if (code === "NOT_FOUND") {
        await expect(backend.get(key)).resolves.toBeNull();
      } else {
        await expect(backend.get(key)).rejects.toMatchObject({
          keychain_code: code,
        });
      }
    }
  });

  it("scrubs raw and enveloped credentials from diagnostics", async () => {
    const envelope = encodeSecret(secret);
    const backend = new LinuxKeychainBackend({
      spawn: mockSpawn({ code: 1, stderr: `${secret} ${envelope}` }),
    });
    let thrown: unknown;
    try {
      await backend.set(key, secret);
    } catch (error) {
      thrown = error;
    }
    const diagnostic =
      thrown instanceof Error
        ? `${thrown.message}\n${thrown.stack ?? ""}`
        : String(thrown);
    expect(diagnostic).not.toContain(secret);
    expect(diagnostic).not.toContain(envelope);
    expect(Object.values(process.env).join("\n")).not.toContain(secret);
    expect(Object.values(process.env).join("\n")).not.toContain(envelope);
  });

  it("terminates a hung child and returns TIMEOUT", async () => {
    const backend = new LinuxKeychainBackend({
      timeoutMs: 10,
      spawn: () => {
        const child = new EventEmitter() as MockChild;
        child.stdin = new Writable({
          write: (_chunk, _encoding, callback) => callback(),
        });
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = (signal = "SIGTERM") => {
          child.emit("close", null, signal);
          return true;
        };
        return child as unknown as ChildProcess;
      },
    });
    await expect(backend.get(key)).rejects.toMatchObject({
      keychain_code: "TIMEOUT",
    });
  });

  it("exposes fixed API and license accounts through the facade", async () => {
    const values = new Map<string, string>();
    const backend = new KeychainFacade({
      get: async (entry) => values.get(entry.account) ?? null,
      set: async (entry, value) => void values.set(entry.account, value),
      delete: async (entry) => void values.delete(entry.account),
    });
    await backend.setApiKey("bl_api_secret");
    await backend.setLicenseKey("license-secret");
    await expect(backend.getApiKey()).resolves.toBe("bl_api_secret");
    await expect(backend.getLicenseKey()).resolves.toBe("license-secret");
    await backend.clear();
    await expect(backend.getApiKey()).resolves.toBeNull();
    await expect(backend.getLicenseKey()).resolves.toBeNull();
  });

  it("selects the current platform backend without a native module", () => {
    expect(createKeychainBackend("darwin")).toBeInstanceOf(KeychainFacade);
    expect(createKeychainBackend("linux")).toBeInstanceOf(KeychainFacade);
    expect(createKeychainBackend("win32")).toBeInstanceOf(KeychainFacade);
  });

  it("contains no shell-string or plaintext fallback implementation", async () => {
    let combined = "";
    for (const path of ["index.ts", "macos.ts", "linux.ts", "windows.ts"]) {
      const source = await readFile(
        new URL(`../../src/core/keychain/${path}`, import.meta.url),
        "utf8",
      );
      combined += source;
    }
    expect(combined).toContain("shell: false");
    expect(combined).not.toMatch(/exec(?:File|Sync)?\s*\(/);
    expect(combined).not.toMatch(/shell:\s*true/);
    expect(combined).not.toMatch(/writeFile|writeFileSync/);
  });

  it("round-trips a hostile secret on the current OS when explicitly enabled", async () => {
    if (process.env.BROWSERLOGIN_REAL_KEYCHAIN !== "1") return;
    const account = `${KEYCHAIN_API_ACCOUNT}-${randomUUID()}`;
    const entry = {
      service: KEYCHAIN_SERVICE,
      account,
    } as unknown as typeof key;
    const backend =
      process.platform === "darwin"
        ? new MacOSKeychainBackend()
        : process.platform === "win32"
          ? new WindowsKeychainBackend()
          : new LinuxKeychainBackend();
    try {
      await backend.set(entry, secret);
      await expect(backend.get(entry)).resolves.toBe(secret);
    } finally {
      await backend.delete(entry).catch((error) => {
        if (
          !(error instanceof KeychainError) ||
          error.keychain_code !== "NOT_FOUND"
        )
          throw error;
      });
    }
  }, 15_000);

  it("decodes only the versioned UTF-8 envelope", () => {
    expect(decodeSecret(encodeSecret(secret))).toBe(secret);
    expect(() => decodeSecret("plaintext")).toThrow(KeychainError);
  });
});
