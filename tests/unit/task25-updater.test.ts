import { describe, expect, test, vi } from "vitest";
import { UpdateController } from "../../src/bun/updater.js";

describe("stable updater policy", () => {
  test("does not apply without explicit confirmation", async () => {
    const apply = vi.fn(async () => undefined);
    const controller = new UpdateController({
      check: vi.fn(async () => ({
        updateAvailable: true,
        updateReady: true,
        version: "0.2.0",
        hash: "x",
        error: "",
      })),
      apply,
      info: vi.fn(() => ({
        version: "0.2.0",
        hash: "x",
        updateAvailable: true,
        updateReady: true,
        error: "",
      })),
    });
    const result = await controller.applyAfterConfirmation(false);
    expect(apply).not.toHaveBeenCalled();
    expect(result.error).toContain("confirmation");
  });

  test("checks, downloads, and falls back to the release page after confirmed apply failure", async () => {
    const openExternal = vi.fn(() => true);
    const download = vi.fn(async () => undefined);
    const controller = new UpdateController({
      openExternal,
      check: vi.fn(async () => ({
        updateAvailable: true,
        updateReady: false,
        version: "0.2.0",
        hash: "x",
        error: "",
      })),
      download,
      apply: vi.fn(async () => {
        throw new Error("sensitive updater detail");
      }),
      info: vi.fn(() => ({
        version: "0.2.0",
        hash: "x",
        updateAvailable: true,
        updateReady: true,
        error: "",
      })),
    });
    await expect(controller.downloadUpdate()).resolves.toMatchObject({
      channel: "stable",
      updateAvailable: true,
      updateReady: true,
    });
    expect(download).toHaveBeenCalledTimes(1);
    const result = await controller.applyAfterConfirmation(true);
    expect(result.error).toBe("Update could not be applied automatically.");
    expect(JSON.stringify(result)).not.toContain("sensitive updater detail");
    expect(openExternal).toHaveBeenCalledTimes(1);
  });
});
