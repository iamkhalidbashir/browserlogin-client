import {
  legacyRestBaseUrlToOrigin,
  validateAppOrigin,
} from "./origin.js";

export const KEYCHAIN_REF = "keychain" as const;

export type ConnectionState = {
  readonly schema_version: 3;
  readonly app_origin: string;
  readonly key_ref: "keychain";
};

export function parseConnectionState(value: unknown): {
  readonly state: ConnectionState;
  readonly migrated: boolean;
} {
  if (!value || typeof value !== "object")
    throw new Error("invalid connection state");
  const state = value as Record<string, unknown>;
  if (
    state.schema_version === 3 &&
    typeof state.app_origin === "string" &&
    state.key_ref === KEYCHAIN_REF
  ) {
    return {
      state: {
        schema_version: 3,
        app_origin: validateAppOrigin(state.app_origin),
        key_ref: KEYCHAIN_REF,
      },
      migrated: false,
    };
  }
  if (
    state.schema_version === 2 &&
    typeof state.base_url === "string" &&
    state.key_ref === KEYCHAIN_REF
  ) {
    return {
      state: {
        schema_version: 3,
        app_origin: legacyRestBaseUrlToOrigin(state.base_url),
        key_ref: KEYCHAIN_REF,
      },
      migrated: true,
    };
  }
  throw new Error("invalid connection state");
}
