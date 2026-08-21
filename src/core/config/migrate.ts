import {
  KEYCHAIN_API_ACCOUNT,
  KEYCHAIN_SERVICE,
} from "../../shared/keychain-types";
import type { KeychainBackend } from "../../shared/keychain-types";
import { createKeychainBackend } from "../keychain";
import { atomicWriteJson, readJson } from "./store";
import { posixPathSecurity } from "./paths";
import type { PathSecurity, StatePaths } from "./paths";
import {
  legacyRestBaseUrlToOrigin,
  validateApiKey,
} from "./connection";

type LegacyConnection = {
  base_url?: unknown;
  api_key?: unknown;
  apiKey?: unknown;
};

export async function migrateLegacyConnection(
  paths: StatePaths,
  keychain: KeychainBackend = createKeychainBackend(),
  security: PathSecurity = posixPathSecurity(),
): Promise<boolean> {
  const legacy = await readJson<LegacyConnection>(paths.connection, security);
  if (!legacy || typeof legacy !== "object") return false;
  const apiKey = legacy.api_key ?? legacy.apiKey;
  if (typeof apiKey !== "string" || apiKey.length === 0) return false;
  if (typeof legacy.base_url !== "string")
    throw new Error("legacy connection is missing base_url");
  const appOrigin = legacyRestBaseUrlToOrigin(legacy.base_url);
  const validatedApiKey = validateApiKey(apiKey);

  await keychain.set(
    { service: KEYCHAIN_SERVICE, account: KEYCHAIN_API_ACCOUNT },
    validatedApiKey,
  );
  await atomicWriteJson(
    paths.connection,
    { schema_version: 3, app_origin: appOrigin, key_ref: "keychain" },
    security,
  );
  const migrated = await readJson<Record<string, unknown>>(
    paths.connection,
    security,
  );
  if (migrated?.api_key !== undefined || migrated?.apiKey !== undefined) {
    throw new Error("legacy connection secret remained on disk");
  }
  return true;
}
