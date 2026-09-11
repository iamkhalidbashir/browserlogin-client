import { beforeEach, describe, expect, test, vi } from "vitest";
import { createElectrobunBridge } from "../../src/mainview/rpc-client.js";

const electrobunMock = vi.hoisted(() => ({
  createView: vi.fn(),
  defineRPC: vi.fn(),
  request: vi.fn(),
}));

vi.mock("electrobun/view", () => ({
  Electroview: Object.assign(electrobunMock.createView, {
    defineRPC: electrobunMock.defineRPC,
  }),
}));

describe("Electrobun renderer RPC", () => {
  beforeEach(() => {
    electrobunMock.createView.mockReset();
    electrobunMock.defineRPC.mockReset();
    electrobunMock.request.mockReset();
    electrobunMock.request.mockResolvedValue({
      ok: false,
      error: { code: "TEST", message: "test response" },
    });
    electrobunMock.defineRPC.mockReturnValue({
      request: electrobunMock.request,
    });
  });

  test("keeps runtime downloads alive while preserving the default timeout for other requests", async () => {
    // Given
    const bridge = await createElectrobunBridge();

    // When
    await bridge.request("binaryDownload", {
      advancedEnabled: false,
      source: "license",
    });
    await bridge.request("binaryProgress", {});

    // Then
    expect(electrobunMock.request).toHaveBeenNthCalledWith(
      1,
      "binaryDownload",
      { advancedEnabled: false, source: "license" },
      { maxRequestTime: Infinity },
    );
    expect(electrobunMock.request).toHaveBeenNthCalledWith(
      2,
      "binaryProgress",
      {},
    );
  });
});
