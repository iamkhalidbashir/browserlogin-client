export const KEYCHAIN_SERVICE = "co.browserlogin.app" as const;
export const KEYCHAIN_API_ACCOUNT = "browserlogin-api-key" as const;
export const KEYCHAIN_LICENSE_ACCOUNT = "cloakbrowser-license-key" as const;
export const KEYCHAIN_ACCOUNT_API_KEY = KEYCHAIN_API_ACCOUNT;
export const KEYCHAIN_ACCOUNT_LICENSE_KEY = KEYCHAIN_LICENSE_ACCOUNT;

export type KeychainAccount =
  typeof KEYCHAIN_API_ACCOUNT | typeof KEYCHAIN_LICENSE_ACCOUNT;

export type KeychainServiceAccount = {
  service: typeof KEYCHAIN_SERVICE;
  account: KeychainAccount;
};

export interface KeychainBackend {
  get(key: KeychainServiceAccount): Promise<string | null>;
  set(key: KeychainServiceAccount, secret: string): Promise<void>;
  delete(key: KeychainServiceAccount): Promise<void>;
}
