import { KEYCHAIN_API_ACCOUNT, KEYCHAIN_SERVICE } from "../../shared/keychain-types";
import type { KeychainBackend } from "../../shared/keychain-types";
import { atomicWriteJson, readJson } from "./store";
import { posixPathSecurity } from "./paths";
import type { PathSecurity, StatePaths } from "./paths";

type LegacyConnection = { base_url?: unknown; api_key?: unknown; apiKey?: unknown };

export async function migrateLegacyConnection(
  paths: StatePaths,
  keychain: KeychainBackend,
  security: PathSecurity = posixPathSecurity(),
): Promise<boolean> {
  const legacy = await readJson<LegacyConnection>(paths.connection, security);
  if (!legacy || typeof legacy !== "object") return false;
  if ((legacy as { schema_version?: unknown }).schema_version === 2) return false;
  const apiKey = legacy.api_key ?? legacy.apiKey;
  if (typeof apiKey !== "string" || apiKey.length === 0) return false;
  const baseUrl = typeof legacy.base_url === "string" ? legacy.base_url : undefined;
  if (!baseUrl) throw new Error("legacy connection is missing base_url");

  await keychain.set(
    { service: KEYCHAIN_SERVICE, account: KEYCHAIN_API_ACCOUNT },
    apiKey,
  );
  await atomicWriteJson(
    paths.connection,
    { schema_version: 2, base_url: baseUrl, key_ref: "keychain" },
    security,
  );
  const migrated = await readJson<Record<string, unknown>>(paths.connection, security);
  if (migrated?.api_key !== undefined || migrated?.apiKey !== undefined) {
    throw new Error("legacy connection secret remained on disk");
  }
  return true;
}
