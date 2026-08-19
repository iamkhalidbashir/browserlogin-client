import type { SupportedPlatform } from "../config/paths.js";

export type BinaryPlatform = "darwin-arm64" | "windows-x64" | "linux-x64";
export type BinarySource = "official" | "custom";

export type ProgressEvent = {
  downloaded: number;
  total: number | undefined;
  done: boolean;
};

export type BinaryInfo = {
  path: string;
  version: string | undefined;
  platform: BinaryPlatform | undefined;
  pro: boolean;
  sha256: string | undefined;
  binarySha256: string | undefined;
  source: BinarySource;
  trust: "verified" | "unverified-custom" | "override";
};

export type BinaryErrorCode =
  | "UNSUPPORTED_PLATFORM"
  | "VERSION_UNAVAILABLE"
  | "DOWNLOAD_FAILED"
  | "DISK_SPACE"
  | "VERIFICATION_FAILED"
  | "INSTALL_FAILED";

export class BinaryManagerError extends Error {
  constructor(
    message: string,
    public readonly code: BinaryErrorCode,
    options?: ErrorOptions,
    public readonly retryable = false,
  ) {
    super(message, options);
    this.name = "BinaryManagerError";
  }
}

export class BrowserInitializationRequiredError extends Error {
  readonly code = "BROWSER_INIT_REQUIRED";

  constructor() {
    super(
      "CloakBrowser is not initialized. Call browser_init, then retry browser_session_start.",
    );
    this.name = "BrowserInitializationRequiredError";
  }
}

export type BinaryFetch = typeof fetch;
export type BinaryPlatformInput = {
  platform?: NodeJS.Platform | string;
  arch?: string;
};

export type VersionResolutionOptions = BinaryPlatformInput & {
  pro?: boolean;
  licenseKey?: string;
  requestedVersion?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: BinaryFetch;
  markerDirectory?: string;
  now?: () => number;
  githubApiUrl?: string;
  proVersionUrl?: string;
};

export type DownloadOptions = {
  url: string;
  destination: string;
  headers?: Record<string, string>;
  expectedBytes?: number;
  progress?: (event: ProgressEvent) => void;
  fetchImpl?: BinaryFetch;
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
  retries?: number;
  diskSpace?: (path: string) => Promise<{ available: number }>;
  extractHeadroomBytes?: number;
};

export type EnsureBinaryOptions = VersionResolutionOptions & {
  cacheDirectory?: string;
  downloadUrl?: string;
  progress?: (event: ProgressEvent) => void;
  diskSpace?: (path: string) => Promise<{ available: number }>;
  healthCallback?: (info: BinaryInfo) => Promise<boolean> | boolean;
  totalTimeoutMs?: number;
};

export type InstallOptions = {
  archive: string;
  root: string;
  version: string;
  pro: boolean;
  platform: BinaryPlatform;
  sha256: string;
  source: BinarySource;
  trust: "verified" | "unverified-custom";
  sourceId?: string;
  healthCallback?: (info: BinaryInfo) => Promise<boolean> | boolean;
};

export function platformSystem(platform: BinaryPlatform): SupportedPlatform {
  return platform.startsWith("darwin")
    ? "darwin"
    : platform.startsWith("windows")
      ? "win32"
      : "linux";
}
