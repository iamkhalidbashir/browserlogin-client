export type ConnectionInput = {
  readonly appOrigin?: string;
  readonly apiKey?: string;
  readonly licenseKey?: string;
};

export type ConnectionResolution = {
  readonly appOrigin: string;
  readonly restBaseUrl: string;
  readonly remoteMcpUrl: string;
  readonly apiKey: string | null;
  readonly licenseKey: string | null;
  readonly source: "cli" | "env" | "keychain" | "persisted" | "default";
};
