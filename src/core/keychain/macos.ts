import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const helperSource = `import Foundation
import Security

let args = CommandLine.arguments
guard args.count == 4 else { exit(64) }
let operation = args[1]
let service = args[2]
let account = args[3]
let input = FileHandle.standardInput.readDataToEndOfFile()
guard input.last == 10 else { exit(65) }
let envelope = input.dropLast()

func report(_ status: OSStatus) -> Never {
  fputs("status=\\(status)\\n", stderr)
  if status == errSecItemNotFound { exit(44) }
  if status == errSecInteractionNotAllowed || status == errSecInteractionRequired { exit(45) }
  if status == errSecAuthFailed { exit(46) }
  exit(1)
}

guard SecKeychainSetUserInteractionAllowed(false) == errSecSuccess else { report(errSecInteractionRequired) }

func withCString<T>(_ value: String, _ body: (UnsafePointer<CChar>, UInt32) -> T) -> T {
  let data = Data(value.utf8)
  return data.withUnsafeBytes { bytes in
    body(bytes.bindMemory(to: CChar.self).baseAddress!, UInt32(data.count))
  }
}

func findItem() -> SecKeychainItem? {
  var passwordLength: UInt32 = 0
  var passwordData: UnsafeMutableRawPointer?
  var item: SecKeychainItem?
  let status = withCString(service) { serviceBytes, serviceLength in
    withCString(account) { accountBytes, accountLength in
      SecKeychainFindGenericPassword(nil, serviceLength, serviceBytes, accountLength, accountBytes, &passwordLength, &passwordData, &item)
    }
  }
  if passwordData != nil { SecKeychainItemFreeContent(nil, passwordData) }
  if status == errSecItemNotFound { return nil }
  if status != errSecSuccess { report(status) }
  return item
}

if operation == "set" {
  if let item = findItem() {
    let deleteStatus = SecKeychainItemDelete(item)
    if deleteStatus != errSecSuccess && deleteStatus != errSecItemNotFound { report(deleteStatus) }
  }
  let status = withCString(service) { serviceBytes, serviceLength in
    withCString(account) { accountBytes, accountLength in
      envelope.withUnsafeBytes { passwordBytes in
        SecKeychainAddGenericPassword(nil, serviceLength, serviceBytes, accountLength, accountBytes, UInt32(envelope.count), passwordBytes.baseAddress!, nil)
      }
    }
  }
  if status != errSecSuccess { report(status) }
} else if operation == "get" {
  var passwordLength: UInt32 = 0
  var passwordData: UnsafeMutableRawPointer?
  var item: SecKeychainItem?
  let status = withCString(service) { serviceBytes, serviceLength in
    withCString(account) { accountBytes, accountLength in
      SecKeychainFindGenericPassword(nil, serviceLength, serviceBytes, accountLength, accountBytes, &passwordLength, &passwordData, &item)
    }
  }
  if status != errSecSuccess { report(status) }
  if let passwordData {
    FileHandle.standardOutput.write(Data(bytes: passwordData, count: Int(passwordLength)))
    FileHandle.standardOutput.write(Data([10]))
    SecKeychainItemFreeContent(nil, passwordData)
  } else { report(errSecItemNotFound) }
} else if operation == "delete" {
  if let item = findItem() {
    let status = SecKeychainItemDelete(item)
    if status != errSecSuccess && status != errSecItemNotFound { report(status) }
  }
} else {
  exit(64)
}
`;

export const MACOS_HELPER_SOURCE = helperSource;

export class MacOSKeychainBackend implements KeychainBackend {
  constructor(private readonly options: KeychainOptions = {}) {}

  private async run(
    operation: "get" | "set" | "delete",
    key: KeychainServiceAccount,
    secret?: string,
  ) {
    const envelope = secret === undefined ? undefined : encodeSecret(secret);
    const directory = await mkdtemp(join(tmpdir(), "browserlogin-keychain-"));
    const helper = join(directory, "helper");
    try {
      const compile = await runKeychainCommand(
        "/usr/bin/swiftc",
        ["-framework", "Security", "-o", helper, "-"],
        helperSource,
        this.options,
      );
      if (compile.code !== 0 || compile.signal)
        throw keychainErrorFromResult(compile);
      const result = await runKeychainCommand(
        helper,
        [operation, key.service, key.account],
        `${envelope ?? ""}\n`,
        this.options,
        envelope,
      );
      if (result.code !== 0 || result.signal)
        throw keychainErrorFromResult(result);
      return result;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
