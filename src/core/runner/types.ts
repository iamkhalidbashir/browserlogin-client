import type { ProcessIdentity } from "../processes/identity.js";
import type { PathSecurity } from "../config/paths.js";

export const READY_MARKER = "browserlogin-runner-ready-v1\n";
export const AUTHORIZATION_MARKER = "authorized\n";
export const STOP_MARKER = "stop\n";

export type LaunchProxy = {
  protocol: string;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
};

export type LaunchSpec = {
  profile_id: string;
  seed: number;
  platform: "macos" | "linux" | "windows";
  geoip: boolean;
  humanize: boolean;
  human_preset: "default" | "careful";
  bumblebee_profile: "default" | "precise" | "fast" | "natural" | "messy";
  headless: boolean;
  timezone: string | null;
  locale: string | null;
  user_agent: string | null;
  viewport: { width: number; height: number } | null;
  args: readonly string[];
  user_data_dir: string;
  browser_cache_dir: string;
  browser_cache_max_bytes: number;
  proxy: LaunchProxy | null;
};

export type RunnerPaths = {
  launchFile: string;
  gateFile: string;
  controlFile: string;
  readyFile: string;
};

export type SpawnedRunner = {
  identity: ProcessIdentity;
  completion: Promise<ChildExit>;
  sendSignal?: (signal: NodeJS.Signals) => void;
};

export type ChildExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

export type BrowserContextLike = {
  pages(): readonly unknown[];
  close(): Promise<void>;
  on(event: "close", listener: () => void): void;
  off(event: "close", listener: () => void): void;
  browser?: () => {
    isConnected(): boolean;
    on?: (event: "disconnected", listener: () => void) => void;
    off?: (event: "disconnected", listener: () => void) => void;
  } | null;
};

export type CloakBrowserSdk = {
  launchPersistentContext(
    options: Record<string, unknown>,
  ): Promise<BrowserContextLike>;
};

export type RunnerChildOptions = {
  spec?: LaunchSpec;
  expectedProfileId?: string;
  paths: RunnerPaths;
  cdpTimeoutMs?: number;
  gateTimeoutMs?: number;
  pollMs?: number;
  sdk?: CloakBrowserSdk;
  normalStop?: () => Promise<void> | void;
};

export type RunnerSupervisorOptions = {
  spec: LaunchSpec;
  paths: RunnerPaths;
  binaryPath: string;
  licenseKey?: string;
  licenseApiUrl?: string;
  cwd: string;
  spawn?: (
    argv: readonly string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ) => Promise<SpawnedRunner> | SpawnedRunner;
  assertIdentity?: (identity: ProcessIdentity) => Promise<ProcessIdentity>;
  stopTree?: (identity: ProcessIdentity, timeoutMs: number) => Promise<boolean>;
  readyTimeoutMs?: number;
  cooperativeStopTimeoutMs?: number;
  hardStopTimeoutMs?: number;
  onReady?: () => Promise<void> | void;
  healthCallback?: () => Promise<boolean> | boolean;
  onNormalStop?: () => Promise<void> | void;
  isAlive?: (identity: ProcessIdentity) => Promise<boolean>;
  pathSecurity?: PathSecurity;
};
