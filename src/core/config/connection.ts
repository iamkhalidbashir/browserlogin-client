import {
  KEYCHAIN_API_ACCOUNT,
  KEYCHAIN_LICENSE_ACCOUNT,
  KEYCHAIN_SERVICE,
} from "../../shared/keychain-types";
import type { KeychainBackend } from "../../shared/keychain-types";
import { BrowserLoginError } from "../../shared/errors";
import {
  ensureStatePaths,
  posixPathSecurity,
  resolveStateRoot,
  statePaths,
} from "./paths";
import type { PathSecurity, StatePathOptions, StatePaths } from "./paths";
import { atomicWriteJson, configStore, readJson } from "./store";

export const DEFAULT_BASE_URL =
  "https://noble-spark-8295-06576bc2.app-csite-env.sapps.co/api/v1";
export const KEYCHAIN_REF = "keychain" as const;
export const PENDING_SCHEMA_VERSION = 1 as const;

export type ConnectionState = {
  schema_version: 2;
  base_url: string;
  key_ref: "keychain";
};
export type ConnectionInput = {
  baseUrl?: string;
  apiKey?: string;
  licenseKey?: string;
};
export type ConnectionResolution = {
  baseUrl: string;
  apiKey: string | null;
  licenseKey: string | null;
  source: "cli" | "env" | "keychain" | "persisted" | "default";
};

export interface ConnectionTransitionLock {
  withLock<T>(operation: () => Promise<T>): Promise<T>;
}

export class SetupRequiredError extends BrowserLoginError {
  constructor() {
    super("BrowserLogin connection setup is required", "SETUP_REQUIRED");
  }
}

export class RecoveryPendingError extends BrowserLoginError {
  constructor() {
    super(
      "Connection changes are unavailable while recovery is pending",
      "RECOVERY_PENDING",
    );
  }
}

function nonempty(value: string | undefined): string | undefined {
  return value && value.trim() !== "" ? value : undefined;
}

export function validateBaseUrl(value: string): string {
  if (
    value !== value.trim() ||
    !value.startsWith("https://") ||
    value.includes("\n") ||
    value.includes("\r")
  )
    throw new TypeError("base URL must use HTTPS");
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new TypeError("invalid base URL");
  return value;
}

export function validateApiKey(value: string): string {
  if (!/^bl_[\x21-\x7e]+$/.test(value) || !value.slice(3).includes("_"))
    throw new TypeError("invalid API key");
  return value;
}

function validateState(value: unknown): ConnectionState {
  if (!value || typeof value !== "object")
    throw new Error("invalid connection state");
  const state = value as Record<string, unknown>;
  if (
    state.schema_version !== 2 ||
    typeof state.base_url !== "string" ||
    state.key_ref !== KEYCHAIN_REF
  ) {
    throw new Error("invalid connection state");
  }
  if (!state.base_url.startsWith("https://"))
    throw new Error("invalid connection base URL");
  return { schema_version: 2, base_url: state.base_url, key_ref: KEYCHAIN_REF };
}

class InMemoryTransitionLock implements ConnectionTransitionLock {
  private tail = Promise.resolve();
  withLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function connectionStatePaths(
  options: StatePathOptions = {},
): StatePaths {
  return statePaths(resolveStateRoot(options));
}

export async function resolveConnection(
  input: ConnectionInput & {
    env?: NodeJS.ProcessEnv;
    paths: StatePaths;
    keychain: KeychainBackend;
  },
  security: PathSecurity = posixPathSecurity(),
): Promise<ConnectionResolution> {
  const cliUrl = nonempty(input.baseUrl);
  const cliKey = nonempty(input.apiKey);
  const cliLicenseKey = nonempty(input.licenseKey);
  const env = input.env ?? process.env;
  const envUrl = nonempty(
    env.BROWSERLOGIN_BASE_URL ?? env.BROWSERLOGIN_API_BASE_URL,
  );
  const envKey = nonempty(env.BROWSERLOGIN_API_KEY ?? env.CLOAKBROWSER_API_KEY);
  const envLicenseKey = nonempty(env.CLOAKBROWSER_LICENSE_KEY);
  const state = await readJson<unknown>(input.paths.connection, security);
  let persistedUrl: string | undefined;
  if (state) {
    const saved = validateState(state);
    persistedUrl = saved.base_url;
  }
  const keychainKey = await input.keychain.get({
    service: KEYCHAIN_SERVICE,
    account: KEYCHAIN_API_ACCOUNT,
  });
  const keychainLicense = await input.keychain.get({
    service: KEYCHAIN_SERVICE,
    account: KEYCHAIN_LICENSE_ACCOUNT,
  });
  const baseUrl = validateBaseUrl(
    cliUrl ?? envUrl ?? persistedUrl ?? DEFAULT_BASE_URL,
  );
  const apiKey = cliKey
    ? validateApiKey(cliKey)
    : envKey
      ? validateApiKey(envKey)
      : keychainKey;
  const licenseKey = cliLicenseKey ?? envLicenseKey ?? keychainLicense;
  const source =
    cliUrl || cliKey || cliLicenseKey
      ? "cli"
      : envUrl || envKey || envLicenseKey
        ? "env"
        : persistedUrl || keychainKey || keychainLicense
          ? keychainKey || keychainLicense
            ? "keychain"
            : "persisted"
          : "default";
  return { baseUrl, apiKey, licenseKey, source };
}

export class ConnectionStore {
  readonly paths: StatePaths;
  private readonly security: PathSecurity;
  private readonly lock: ConnectionTransitionLock;

  constructor(
    root: string,
    private readonly keychain: KeychainBackend,
    options: { security?: PathSecurity; lock?: ConnectionTransitionLock } = {},
  ) {
    this.paths = statePaths(root);
    this.security = options.security ?? posixPathSecurity();
    this.lock = options.lock ?? new InMemoryTransitionLock();
  }

  async initialize(): Promise<void> {
    await ensureStatePaths(this.paths, this.security);
  }

  async read(): Promise<ConnectionState | null> {
    const value = await configStore(
      this.paths.root,
      this.security,
    ).read<unknown>();
    return value === null ? null : validateState(value);
  }

  async pending(): Promise<boolean> {
    const value = await readJson<unknown>(
      this.paths.connectionPending,
      this.security,
    );
    if (value === null) return false;
    if (
      !value ||
      typeof value !== "object" ||
      (value as Record<string, unknown>).schema_version !== 1 ||
      (value as Record<string, unknown>).status !== "pending"
    ) {
      throw new RecoveryPendingError();
    }
    return true;
  }

  async canReconfigure(): Promise<boolean> {
    try {
      return (await this.read()) !== null && !(await this.pending());
    } catch {
      return false;
    }
  }

  async save(baseUrl: string, apiKey: string): Promise<void> {
    const validatedUrl = validateBaseUrl(baseUrl);
    const validatedKey = validateApiKey(apiKey);
    await this.initialize();
    await this.lock.withLock(async () => {
      if (await this.pending()) throw new RecoveryPendingError();
      if ((await this.read()) !== null)
        await this.assertReconfigurationAvailable();
      await this.keychain.set(
        { service: KEYCHAIN_SERVICE, account: KEYCHAIN_API_ACCOUNT },
        validatedKey,
      );
      await atomicWriteJson(
        this.paths.connection,
        { schema_version: 2, base_url: validatedUrl, key_ref: KEYCHAIN_REF },
        this.security,
      );
      const verified = await this.read();
      if (
        !verified ||
        verified.base_url !== validatedUrl ||
        verified.key_ref !== KEYCHAIN_REF
      )
        throw new Error("connection verification failed");
    });
  }

  async resolve(
    input: Omit<ConnectionInput, "env"> & { env?: NodeJS.ProcessEnv } = {},
  ): Promise<ConnectionResolution> {
    await this.initialize();
    return resolveConnection(
      { ...input, paths: this.paths, keychain: this.keychain },
      this.security,
    );
  }

  async assertReconfigurationAvailable(): Promise<void> {
    if ((await this.read()) === null) throw new SetupRequiredError();
    if (await this.pending()) throw new RecoveryPendingError();
  }
}

export function connectionStore(
  options: StatePathOptions & {
    keychain: KeychainBackend;
    security?: PathSecurity;
    lock?: ConnectionTransitionLock;
  },
): ConnectionStore {
  return new ConnectionStore(
    resolveStateRoot(options),
    options.keychain,
    options,
  );
}
