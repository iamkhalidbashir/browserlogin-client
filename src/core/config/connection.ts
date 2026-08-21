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
import {
  KEYCHAIN_REF,
  parseConnectionState,
  type ConnectionState,
} from "./connection-state.js";
import type { ConnectionInput, ConnectionResolution } from "./connection-types.js";
import {
  DEFAULT_APP_ORIGIN,
  deriveRemoteMcpUrl,
  deriveRestBaseUrl,
  legacyRestBaseUrlToOrigin,
  validateAppOrigin,
} from "./origin.js";

export { KEYCHAIN_REF, type ConnectionState } from "./connection-state.js";
export type { ConnectionInput, ConnectionResolution } from "./connection-types.js";
export {
  DEFAULT_APP_ORIGIN,
  REMOTE_MCP_PATH,
  REST_API_PATH,
  deriveRemoteMcpUrl,
  deriveRestBaseUrl,
  legacyRestBaseUrlToOrigin,
  validateAppOrigin,
} from "./origin.js";
export const PENDING_SCHEMA_VERSION = 1 as const;

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

export function validateApiKey(value: string): string {
  if (!/^bl_[\x21-\x7e]+$/.test(value) || !value.slice(3).includes("_"))
    throw new TypeError("invalid API key");
  return value;
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
  const cliOrigin = nonempty(input.appOrigin);
  const cliKey = nonempty(input.apiKey);
  const cliLicenseKey = nonempty(input.licenseKey);
  const env = input.env ?? process.env;
  const envOrigin = nonempty(env.BROWSERLOGIN_BASE_URL);
  const legacyEnvRestBaseUrl = nonempty(env.BROWSERLOGIN_API_BASE_URL);
  const envKey = nonempty(env.BROWSERLOGIN_API_KEY ?? env.CLOAKBROWSER_API_KEY);
  const envLicenseKey = nonempty(env.CLOAKBROWSER_LICENSE_KEY);
  const state = await readJson<unknown>(input.paths.connection, security);
  let persistedOrigin: string | undefined;
  if (state) {
    const saved = parseConnectionState(state);
    persistedOrigin = saved.state.app_origin;
    if (saved.migrated)
      await atomicWriteJson(input.paths.connection, saved.state, security);
  }
  const useKeychain = !(cliKey || envKey || cliLicenseKey || envLicenseKey);
  const [keychainKey, keychainLicense] = useKeychain
    ? await Promise.all([
        input.keychain.get({
          service: KEYCHAIN_SERVICE,
          account: KEYCHAIN_API_ACCOUNT,
        }),
        input.keychain.get({
          service: KEYCHAIN_SERVICE,
          account: KEYCHAIN_LICENSE_ACCOUNT,
        }),
      ])
    : [null, null];
  const appOrigin = validateAppOrigin(
    cliOrigin ??
      envOrigin ??
      (legacyEnvRestBaseUrl
        ? legacyRestBaseUrlToOrigin(legacyEnvRestBaseUrl)
        : undefined) ??
      persistedOrigin ??
      DEFAULT_APP_ORIGIN,
  );
  const apiKey = cliKey
    ? validateApiKey(cliKey)
    : envKey
      ? validateApiKey(envKey)
      : keychainKey;
  const licenseKey = cliLicenseKey ?? envLicenseKey ?? keychainLicense;
  const source =
    cliOrigin || cliKey || cliLicenseKey
      ? "cli"
      : envOrigin || legacyEnvRestBaseUrl || envKey || envLicenseKey
        ? "env"
        : persistedOrigin || keychainKey || keychainLicense
          ? keychainKey || keychainLicense
            ? "keychain"
            : "persisted"
          : "default";
  return {
    appOrigin,
    restBaseUrl: deriveRestBaseUrl(appOrigin),
    remoteMcpUrl: deriveRemoteMcpUrl(appOrigin),
    apiKey,
    licenseKey,
    source,
  };
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
    if (value === null) return null;
    const parsed = parseConnectionState(value);
    if (parsed.migrated)
      await atomicWriteJson(this.paths.connection, parsed.state, this.security);
    return parsed.state;
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

  async save(appOrigin: string, apiKey: string): Promise<void> {
    const validatedOrigin = validateAppOrigin(appOrigin);
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
        {
          schema_version: 3,
          app_origin: validatedOrigin,
          key_ref: KEYCHAIN_REF,
        },
        this.security,
      );
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
