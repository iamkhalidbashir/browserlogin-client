import { describe, expect, test, vi } from "vitest";
import type { ensureBinary } from "../../src/core/binary/index.js";
import {
  BrowserInitializer,
  BrowserLicenseRequiredError,
} from "../../src/mcp/binary-initialization.js";

const binary = {
  path: "/tmp/cloakbrowser",
  version: "1.0.0",
  platform: "darwin-arm64" as const,
  pro: false,
  sha256: "a".repeat(64),
  binarySha256: "b".repeat(64),
  source: "official" as const,
  trust: "verified" as const,
};

describe("MCP browser initialization", () => {
  test("initializes Free with a one-hour transfer window and reports progress", async () => {
    const initializeBinaryMock = vi.fn(async (options) => {
      options.progress?.({ downloaded: 5, total: 10, done: false });
      options.progress?.({ downloaded: 10, total: 10, done: true });
      return binary;
    });
    const initializeBinary = initializeBinaryMock as typeof ensureBinary;
    const initializer = new BrowserInitializer({
      root: "/tmp/browserlogin",
      licenseKey: "unused-license",
      initializeBinary,
      activeBinary: async () => undefined,
    });

    await expect(initializer.initialize("free")).resolves.toMatchObject({
      state: "ready",
      downloaded: 10,
      total: 10,
      binary,
    });
    expect(initializeBinary).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheDirectory: "/tmp/browserlogin",
        pro: false,
        totalTimeoutMs: 3_600_000,
      }),
    );
    expect(initializeBinaryMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "licenseKey",
    );
  });

  test("requires a configured license for the licensed source", async () => {
    const initializer = new BrowserInitializer({
      root: "/tmp/browserlogin",
      licenseKey: null,
    });

    await expect(initializer.initialize("license")).rejects.toBeInstanceOf(
      BrowserLicenseRequiredError,
    );
  });
});
