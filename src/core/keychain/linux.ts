import {
  decodeSecret,
  encodeSecret,
  keychainErrorFromResult,
  runKeychainCommand,
} from "./index";
import type { KeychainOptions } from "./index";
import type {
  KeychainBackend,
  KeychainServiceAccount,
} from "../../shared/keychain-types";

const unavailableMessage =
  "Linux Secret Service backend unavailable: install libsecret-tools, start a Secret Service provider such as GNOME Keyring or KeePassXC, and run with a user D-Bus session.";

function attributes(key: KeychainServiceAccount): string[] {
  return ["service", key.service, "account", key.account];
}

export class LinuxKeychainBackend implements KeychainBackend {
  constructor(private readonly options: KeychainOptions = {}) {}

  private async run(
    operation: "get" | "set" | "delete",
    key: KeychainServiceAccount,
    secret?: string,
  ) {
    const envelope = secret === undefined ? undefined : encodeSecret(secret);
    const args =
      operation === "get"
        ? ["lookup", ...attributes(key)]
        : operation === "set"
          ? ["store", "--label=BrowserLogin", ...attributes(key)]
          : ["clear", ...attributes(key)];
    const result = await runKeychainCommand(
      "secret-tool",
      args,
      operation === "set" ? `${envelope}\n` : "",
      this.options,
      envelope,
    );
    if (result.code !== 0 || result.signal) {
      const error = keychainErrorFromResult(
        result,
        result.stderr === "command not found",
      );
      if (error.keychain_code === "BACKEND_UNAVAILABLE")
        error.message = unavailableMessage;
      throw error;
    }
    return result;
  }

  async get(key: KeychainServiceAccount): Promise<string | null> {
    try {
      const result = await this.run("get", key);
      return decodeSecret(result.stdout);
    } catch (error) {
      if (
        error instanceof Error &&
        "keychain_code" in error &&
        (error as { keychain_code: string }).keychain_code === "NOT_FOUND"
      )
        return null;
      throw error;
    }
  }

  async set(key: KeychainServiceAccount, secret: string): Promise<void> {
    await this.run("set", key, secret);
  }

  async delete(key: KeychainServiceAccount): Promise<void> {
    try {
      await this.run("delete", key);
    } catch (error) {
      if (
        error instanceof Error &&
        "keychain_code" in error &&
        (error as { keychain_code: string }).keychain_code === "NOT_FOUND"
      )
        return;
      throw error;
    }
  }
}

export { unavailableMessage as LINUX_KEYCHAIN_REMEDIATION };
