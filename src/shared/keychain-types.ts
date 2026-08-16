export type KeychainServiceAccount = {
  service: string;
  account: string;
};

export interface KeychainBackend {
  get(key: KeychainServiceAccount): Promise<string | null>;
  set(key: KeychainServiceAccount, secret: string): Promise<void>;
  delete(key: KeychainServiceAccount): Promise<void>;
}
