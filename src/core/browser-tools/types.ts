export type JsonObject = Record<string, unknown>;

export type VendorTool = {
  name: string;
  description?: string;
  inputSchema: JsonObject;
};

export type VendorContent = {
  type: string;
  text?: string;
  [key: string]: unknown;
};

export type VendorCallResult = {
  content: VendorContent[];
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
};

export interface VendorBrowserRuntime {
  listTools(): Promise<VendorTool[]>;
  callTool(name: string, arguments_: JsonObject): Promise<VendorCallResult>;
  close(): Promise<void>;
}

export type VendorBrowserRuntimeFactory = (
  profileId: string,
  relayCdpUrl: string,
) => Promise<VendorBrowserRuntime>;

export type BrowserToolResult = VendorCallResult;

export class ProfileNotRunningError extends Error {
  constructor() {
    super("PROFILE_NOT_RUNNING");
    this.name = "ProfileNotRunningError";
  }
}

export const GENERIC_BROWSER_ERROR =
  "Browser control request could not be completed.";
export const GENERIC_STOP_ERROR =
  "BrowserLogin session stop could not be completed.";
export const ALLOW_UNSAFE_ENV = "BROWSERLOGIN_ALLOW_UNSAFE_BROWSER_CODE";
