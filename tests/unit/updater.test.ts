import { describe, expect, test, vi } from "vitest";
import {
  installLaunchUpdateCheck,
  RELEASE_PAGE,
  UpdateController,
} from "../../src/bun/updater.js";

const updateInfo = (
  overrides: Partial<{
    updateAvailable: boolean;
    updateReady: boolean;
    error: string;
  }> = {},
) => ({
  version: "0.2.0",
  hash: "x",
  updateAvailable: true,
  updateReady: false,
  error: "",
  ...overrides,
});

describe("stable updater policy", () => {
  test("shares an in-flight automatic check with later state reads", async () => {
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const check = vi.fn(async () => {
      await waiting;
      return updateInfo();
    });
    const controller = new UpdateController({ check });

    expect(await controller.latestCheck()).toBeNull();
    installLaunchUpdateCheck(vi.fn(), controller, true);
    const latest = controller.latestCheck();
    finish();

    await expect(latest).resolves.toMatchObject({
      channel: "stable",
      updateAvailable: true,
      updateReady: false,
    });
    expect(check).toHaveBeenCalledTimes(1);
  });

  test("does not launch an automatic check when the preference is disabled", async () => {
    const check = vi.fn(async () => updateInfo());
    const controller = new UpdateController({ check });

    installLaunchUpdateCheck(vi.fn(), controller, false);

    await expect(controller.latestCheck()).resolves.toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  test("normalizes resolved and rejected check failures", async () => {
    const resolved = new UpdateController({
      check: vi.fn(async () =>
        updateInfo({
          updateAvailable: true,
          updateReady: true,
          error: "sensitive metadata failure",
        }),
      ),
    });
    const rejected = new UpdateController({
      check: vi.fn(async () => {
        throw new Error("sensitive transport failure");
      }),
    });

    for (const controller of [resolved, rejected]) {
      const result = await controller.checkForUpdate();
      expect(result).toMatchObject({
        channel: "stable",
        updateAvailable: false,
        updateReady: false,
        error: "Update check failed",
      });
      expect(JSON.stringify(result)).not.toContain("sensitive");
    }
  });

  test("normalizes resolved and rejected download failures", async () => {
    const resolved = new UpdateController({
      check: vi.fn(async () => updateInfo()),
      download: vi.fn(async () => undefined),
      info: vi.fn(() =>
        updateInfo({
          updateReady: true,
          error: "sensitive download failure",
        }),
      ),
    });
    const rejected = new UpdateController({
      check: vi.fn(async () => updateInfo()),
      download: vi.fn(async () => {
        throw new Error("sensitive transport failure");
      }),
    });

    for (const controller of [resolved, rejected]) {
      const result = await controller.downloadUpdate();
      expect(result).toMatchObject({
        channel: "stable",
        updateAvailable: true,
        updateReady: false,
        error: "Update download failed",
      });
      expect(JSON.stringify(result)).not.toContain("sensitive");
    }
  });

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
    const downloaded = await controller.downloadUpdate();
    expect(downloaded).toMatchObject({
      channel: "stable",
      updateAvailable: true,
      updateReady: true,
    });
    await expect(controller.latestCheck()).resolves.toEqual(downloaded);
    expect(download).toHaveBeenCalledTimes(1);
    const result = await controller.applyAfterConfirmation(true);
    expect(result.error).toBe("Update could not be applied automatically.");
    expect(JSON.stringify(result)).not.toContain("sensitive updater detail");
    expect(openExternal).toHaveBeenCalledTimes(1);
    await expect(controller.latestCheck()).resolves.toEqual(result);
  });

  test("falls back when apply resolves with an updater error", async () => {
    const openExternal = vi.fn(() => true);
    const controller = new UpdateController({
      openExternal,
      apply: vi.fn(async () => undefined),
      info: vi.fn(() =>
        updateInfo({
          updateReady: true,
          error: "sensitive apply failure",
        }),
      ),
    });

    const result = await controller.applyAfterConfirmation(true);

    expect(result).toMatchObject({
      channel: "stable",
      updateAvailable: true,
      updateReady: true,
      error: "Update could not be applied automatically.",
      fallbackUrl: RELEASE_PAGE,
    });
    expect(JSON.stringify(result)).not.toContain("sensitive");
    expect(openExternal).toHaveBeenCalledWith(RELEASE_PAGE);
  });
});
