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

const powershellArgs = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "-",
] as const;

function powershellSource(
  operation: "get" | "set" | "delete",
  key: KeychainServiceAccount,
): string {
  const resource = JSON.stringify(key.service);
  const account = JSON.stringify(key.account);
  const action =
    operation === "set"
      ? "$old = $null; try { $old = $vault.Retrieve($resource, $account) } catch {}; if ($null -ne $old) { $vault.Remove($old) }; $bytes = [Convert]::FromBase64String($payload.Substring(5)); $value = [Text.Encoding]::UTF8.GetString($bytes); $vault.Add((New-Object Windows.Security.Credentials.PasswordCredential -ArgumentList $resource,$account,$value))"
      : operation === "get"
        ? "$credential = $vault.Retrieve($resource, $account); $credential.RetrievePassword(); if ($null -eq $credential.Password) { throw 'PasswordVault returned a null password' }; $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($credential.Password)); [Console]::WriteLine(('blv1:' + $encoded))"
        : "$credential = $vault.Retrieve($resource, $account); $vault.Remove($credential)";
  return `$payload = [Console]::In.ReadLine()
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]
$vault = New-Object Windows.Security.Credentials.PasswordVault
$resource = ${resource}
$account = ${account}
try { ${action} } catch { $message = $_.Exception.Message; if ($message -match 'not found|element not found|does not exist') { exit 44 }; [Console]::Error.WriteLine($_.Exception.GetType().FullName); [Console]::Error.WriteLine($message); exit 1 }`;
}

export class WindowsKeychainBackend implements KeychainBackend {
  constructor(private readonly options: KeychainOptions = {}) {}

  private async run(
    operation: "get" | "set" | "delete",
    key: KeychainServiceAccount,
    secret?: string,
  ) {
    const envelope = secret === undefined ? "" : encodeSecret(secret);
    const result = await runKeychainCommand(
      "powershell.exe",
      powershellArgs,
      `${envelope}\n${powershellSource(operation, key)}\n`,
      this.options,
      envelope || undefined,
    );
    if (result.code !== 0 || result.signal) {
      const error = keychainErrorFromResult(result);
      throw error;
    }
    return result;
  }

  async get(key: KeychainServiceAccount): Promise<string | null> {
    try {
      return decodeSecret((await this.run("get", key)).stdout);
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

export const WINDOWS_POWERSHELL_ARGS = powershellArgs;
