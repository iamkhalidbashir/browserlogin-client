import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  ensureBinary,
  readActiveBinary,
  type BinaryInfo,
  type ProgressEvent,
} from "../core/binary/index.js";

export const BROWSER_INIT_TOOL: Tool = {
  name: "browser_init",
  description:
    "Download, verify, and install CloakBrowser. Use a long tool timeout for first-time downloads.",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", enum: ["free", "license"] },
    },
    required: [],
    additionalProperties: false,
  },
};

export const BROWSER_INIT_STATUS_TOOL: Tool = {
  name: "browser_init_status",
  description: "Report CloakBrowser initialization and download progress.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

export type BrowserInitializationSource = "free" | "license";
export type BrowserInitializationState = {
  readonly state: "not-installed" | "downloading" | "ready" | "failed";
  readonly downloaded: number;
  readonly total: number | null;
  readonly binary: BinaryInfo | null;
};

export type BrowserInitializationOperations = {
  initialize(
    source: BrowserInitializationSource,
  ): Promise<BrowserInitializationState>;
  status(): Promise<BrowserInitializationState>;
};

export class BrowserLicenseRequiredError extends Error {
  readonly code = "BROWSER_LICENSE_REQUIRED";

  constructor() {
    super("A CloakBrowser license is required for licensed initialization.");
    this.name = "BrowserLicenseRequiredError";
  }
}

type BrowserInitializerOptions = {
  readonly root: string;
  readonly licenseKey: string | null;
  readonly initializeBinary?: typeof ensureBinary;
  readonly activeBinary?: typeof readActiveBinary;
};

const DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000;

export class BrowserInitializer implements BrowserInitializationOperations {
  private state: BrowserInitializationState = {
    state: "not-installed",
    downloaded: 0,
    total: null,
    binary: null,
  };
  private inFlight: Promise<BrowserInitializationState> | undefined;

  constructor(private readonly options: BrowserInitializerOptions) {}

  async initialize(
    source: BrowserInitializationSource,
  ): Promise<BrowserInitializationState> {
    if (this.inFlight) return this.inFlight;
    if (source === "license" && !this.options.licenseKey)
      throw new BrowserLicenseRequiredError();
    this.state = {
      state: "downloading",
      downloaded: 0,
      total: null,
      binary: null,
    };
    const progress = (event: ProgressEvent) => {
      this.state = {
        state: "downloading",
        downloaded: event.downloaded,
        total: event.total ?? null,
        binary: null,
      };
    };
    const operation = (this.options.initializeBinary ?? ensureBinary)({
      cacheDirectory: this.options.root,
      pro: source === "license",
      ...(source === "license" && this.options.licenseKey
        ? { licenseKey: this.options.licenseKey }
        : {}),
      progress,
      totalTimeoutMs: DOWNLOAD_TIMEOUT_MS,
    })
      .then((binary) => {
        this.state = {
          state: "ready",
          downloaded: this.state.total ?? this.state.downloaded,
          total: this.state.total,
          binary,
        };
        return this.state;
      })
      .catch((error: unknown) => {
        this.state = {
          state: "failed",
          downloaded: this.state.downloaded,
          total: this.state.total,
          binary: null,
        };
        throw error;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    this.inFlight = operation;
    return operation;
  }

  async status(): Promise<BrowserInitializationState> {
    const binary = await (this.options.activeBinary ?? readActiveBinary)(
      this.options.root,
      { env: process.env },
    );
    if (binary) {
      this.state = {
        state: "ready",
        downloaded: this.state.total ?? this.state.downloaded,
        total: this.state.total,
        binary,
      };
    }
    return this.state;
  }
}
