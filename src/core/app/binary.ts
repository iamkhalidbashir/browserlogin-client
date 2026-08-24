import {
  ensureBinary,
  readActiveBinary,
  type BinaryInfo,
  type ProgressEvent,
} from "../binary/index.js";
import type { KeychainFacade } from "../keychain/index.js";
import { ApplicationOperationError } from "./contracts.js";
import { readApplicationSettings } from "./settings.js";

export type BinaryProgress = {
  readonly downloaded: number;
  readonly total: number | null;
  readonly done: boolean;
};

export type BinaryDownloadInput = {
  readonly advancedEnabled: boolean;
  readonly pro?: boolean;
  readonly source?: "free" | "license" | "custom";
  readonly customUrl?: string;
};

export type BrowserInitializationSource = "free" | "license";
export type BrowserInitializationState = {
  readonly state: "not-installed" | "downloading" | "ready" | "failed";
  readonly downloaded: number;
  readonly total: number | null;
  readonly binary: BinaryInfo | null;
};

export class BrowserLicenseRequiredError extends Error {
  readonly name = "BrowserLicenseRequiredError";
  readonly code = "BROWSER_LICENSE_REQUIRED";

  constructor() {
    super("A CloakBrowser license is required for licensed initialization.");
  }
}

type ApplicationBinaryOptions = {
  readonly root: string;
  readonly keychain: Pick<KeychainFacade, "getLicenseKey">;
  readonly progress?: (progress: BinaryProgress) => void;
  readonly initializeBinary?: typeof ensureBinary;
  readonly activeBinary?: typeof readActiveBinary;
};

const DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000;

export class ApplicationBinary {
  private binary: BinaryInfo | null = null;
  private progress: BinaryProgress = { downloaded: 0, total: null, done: true };
  private initialization: BrowserInitializationState = {
    state: "not-installed",
    downloaded: 0,
    total: null,
    binary: null,
  };
  private inFlight: Promise<BrowserInitializationState> | undefined;

  constructor(private readonly options: ApplicationBinaryOptions) {}

  async status(): Promise<BinaryInfo | null> {
    if (!this.binary)
      this.binary =
        (await (this.options.activeBinary ?? readActiveBinary)(
          this.options.root,
          { env: process.env },
        )) ?? null;
    return this.binary;
  }

  currentProgress(): BinaryProgress {
    return this.progress;
  }

  async download(input: BinaryDownloadInput): Promise<BinaryInfo> {
    const settings = await readApplicationSettings(
      this.options.root,
      this.options.keychain,
    );
    const source =
      input.source ??
      (input.pro
        ? "license"
        : settings.download_source === "custom"
          ? "custom"
          : "free");
    if (source === "custom" && !input.advancedEnabled)
      throw new ApplicationOperationError(
        "ADVANCED_CONFIRMATION_REQUIRED",
        "advanced confirmation required",
        false,
      );
    const licenseKey = await this.options.keychain.getLicenseKey();
    if (source === "license" && !licenseKey)
      throw new ApplicationOperationError(
        "LICENSE_REQUIRED",
        "license required",
        false,
      );
    const customUrl =
      source === "custom"
        ? (input.customUrl ?? settings.custom_download_url ?? undefined)
        : undefined;
    if (source === "custom" && !customUrl)
      throw new ApplicationOperationError(
        "CUSTOM_URL_REQUIRED",
        "custom URL required",
        false,
      );
    this.binary = await (this.options.initializeBinary ?? ensureBinary)({
      cacheDirectory: this.options.root,
      ...(source === "license" && licenseKey ? { licenseKey } : {}),
      pro: source === "license",
      ...(customUrl ? { downloadUrl: customUrl } : {}),
      totalTimeoutMs: DOWNLOAD_TIMEOUT_MS,
      progress: (event) => this.updateProgress(event),
    });
    return this.binary;
  }

  async initialize(
    source: BrowserInitializationSource,
  ): Promise<BrowserInitializationState> {
    if (this.inFlight) return this.inFlight;
    const operation = this.initializeOnce(source).finally(() => {
      this.inFlight = undefined;
    });
    this.inFlight = operation;
    return operation;
  }

  async initializationStatus(): Promise<BrowserInitializationState> {
    const binary = await this.status();
    if (binary)
      this.initialization = {
        state: "ready",
        downloaded: this.initialization.total ?? this.initialization.downloaded,
        total: this.initialization.total,
        binary,
      };
    return this.initialization;
  }

  private updateProgress(event: ProgressEvent): void {
    this.progress = {
      downloaded: event.downloaded,
      total: event.total ?? null,
      done: event.done,
    };
    this.initialization = {
      state: "downloading",
      downloaded: event.downloaded,
      total: event.total ?? null,
      binary: null,
    };
    this.options.progress?.(this.progress);
  }

  private async initializeOnce(
    source: BrowserInitializationSource,
  ): Promise<BrowserInitializationState> {
    try {
      if (
        source === "license" &&
        !(await this.options.keychain.getLicenseKey())
      )
        throw new BrowserLicenseRequiredError();
      this.initialization = {
        state: "downloading",
        downloaded: 0,
        total: null,
        binary: null,
      };
      const binary = await this.download({ advancedEnabled: false, source });
      this.initialization = {
        state: "ready",
        downloaded: this.initialization.total ?? this.initialization.downloaded,
        total: this.initialization.total,
        binary,
      };
      return this.initialization;
    } catch (error) {
      this.initialization = {
        state: "failed",
        downloaded: this.initialization.downloaded,
        total: this.initialization.total,
        binary: null,
      };
      throw error;
    }
  }
}
