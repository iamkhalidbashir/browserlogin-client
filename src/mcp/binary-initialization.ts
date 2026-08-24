import {
  ApplicationBinary,
  BrowserLicenseRequiredError,
  type BrowserInitializationSource,
  type BrowserInitializationState,
} from "../core/app/binary.js";
import type { ensureBinary, readActiveBinary } from "../core/binary/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

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

export type { BrowserInitializationSource, BrowserInitializationState };
export { BrowserLicenseRequiredError };

export type BrowserInitializationOperations = {
  initialize(
    source: BrowserInitializationSource,
  ): Promise<BrowserInitializationState>;
  status(): Promise<BrowserInitializationState>;
};

type BrowserInitializerOptions = {
  readonly root: string;
  readonly licenseKey: string | null;
  readonly initializeBinary?: typeof ensureBinary;
  readonly activeBinary?: typeof readActiveBinary;
};

export class BrowserInitializer implements BrowserInitializationOperations {
  private readonly binary: ApplicationBinary;

  constructor(options: BrowserInitializerOptions) {
    this.binary = new ApplicationBinary({
      root: options.root,
      keychain: { getLicenseKey: async () => options.licenseKey },
      ...(options.initializeBinary
        ? { initializeBinary: options.initializeBinary }
        : {}),
      ...(options.activeBinary ? { activeBinary: options.activeBinary } : {}),
    });
  }

  initialize(
    source: BrowserInitializationSource,
  ): Promise<BrowserInitializationState> {
    return this.binary.initialize(source);
  }

  status(): Promise<BrowserInitializationState> {
    return this.binary.initializationStatus();
  }
}
