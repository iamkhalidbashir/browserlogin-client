import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { BrowserLoginClient } from "../../src/core/api/client.js";
import type { ensureBinary } from "../../src/core/binary/index.js";
import type { ConnectionStore } from "../../src/core/config/connection.js";
import type { LifecycleCoordinator } from "../../src/core/coordinator/index.js";
import {
  createRecoveryStore,
  type RecoveryState,
} from "../../src/core/coordinator/state.js";
import type { KeychainFacade } from "../../src/core/keychain/index.js";
import { createCoreAppRuntime } from "../../src/bun/services.js";
import type { UpdateController } from "../../src/bun/updater.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(options: { ensureBinary?: typeof ensureBinary } = {}) {
  const root = await mkdtemp(join(tmpdir(), "browserlogin-task25-services-"));
  roots.push(root);
  let license: string | null = null;
  const keychain = {
    getLicenseKey: vi.fn(async () => license),
    setLicenseKey: vi.fn(async (value: string) => {
      license = value;
    }),
    delete: vi.fn(async () => {
      license = null;
    }),
  } as unknown as KeychainFacade;
  const connection = {
    resolve: vi.fn(async () => ({
      baseUrl: "https://example.test/api/v1",
      apiKey: "bl_test_key_value",
      licenseKey: license,
      source: "keychain" as const,
    })),
    save: vi.fn(async () => undefined),
  } as unknown as ConnectionStore;
  const client = {
    listProxies: vi.fn(async () => [
      {
        id: "proxy-1",
        name: "proxy",
        protocol: "http" as const,
        host: "127.0.0.1",
        port: 8080,
        username: "user",
        password: "renderer-secret",
      },
    ]),
  } as unknown as BrowserLoginClient;
  const coordinator = {
    start: vi.fn(async (profileId: string) => ({ profile_id: profileId })),
    stop: vi.fn(async (profileId: string) => ({ profile_id: profileId })),
    forceStop: vi.fn(async (profileId: string) => ({ profile_id: profileId })),
    recover: vi.fn(async () => undefined),
  } as unknown as LifecycleCoordinator;
  const updateController = {
    checkForUpdate: vi.fn(),
    downloadUpdate: vi.fn(),
    applyAfterConfirmation: vi.fn(),
  } as unknown as UpdateController;
  const runtime = createCoreAppRuntime({
    root,
    keychain,
    connection,
    client,
    coordinator,
    updateController,
    emitProgress: vi.fn(),
    ensureBinary: options.ensureBinary,
  });
  return {
    root,
    services: runtime.services,
    recover: runtime.recover,
    coordinator,
  };
}

describe("Task 25 core service composition", () => {
  test("strips proxy passwords and enforces exact force-stop confirmation", async () => {
    const { services, coordinator } = await fixture();
    const proxies = await services.proxiesList?.({});
    expect(JSON.stringify(proxies)).not.toContain("renderer-secret");
    await expect(
      services.sessionsForceStop?.({
        profileId: "profile-1",
        confirmation: "FORCE CLOSE",
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await expect(
      services.sessionsForceStop?.({
        profileId: "profile-1",
        confirmation: "FORCE CLOSE profile-1",
      }),
    ).resolves.toMatchObject({ profile_id: "profile-1" });
    expect(coordinator.forceStop).toHaveBeenCalledTimes(1);
  });

  test("gates custom download settings behind advanced confirmation", async () => {
    const { services } = await fixture();
    await expect(
      services.settingsSet?.({
        downloadSource: "custom",
        customDownloadUrl: "https://downloads.example.test",
        advancedEnabled: false,
      }),
    ).rejects.toMatchObject({ code: "ADVANCED_CONFIRMATION_REQUIRED" });
    await expect(
      services.settingsSet?.({
        downloadSource: "custom",
        customDownloadUrl: "https://downloads.example.test",
        advancedEnabled: true,
      }),
    ).resolves.toMatchObject({
      download_source: "custom",
      custom_download_url: "https://downloads.example.test",
      update_channel: "stable",
    });
  });

  test("keeps binary download progress in main-process services across renderer queries", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fakeEnsureBinary = vi.fn(async (options) => {
      options.progress?.({ downloaded: 5, total: 10, done: false });
      await gate;
      options.progress?.({ downloaded: 10, total: 10, done: true });
      return {
        path: "/tmp/cloakbrowser",
        version: "1.0.0",
        platform: "darwin-arm64" as const,
        pro: false,
        sha256: "a".repeat(64),
        binarySha256: "b".repeat(64),
        source: "official" as const,
        trust: "verified" as const,
      };
    }) as typeof ensureBinary;
    const { services } = await fixture({ ensureBinary: fakeEnsureBinary });
    const download = services.binaryDownload?.({ advancedEnabled: false });
    await vi.waitFor(async () => {
      await expect(services.binaryProgress?.({})).resolves.toEqual({
        downloaded: 5,
        total: 10,
        done: false,
      });
    });
    release();
    await expect(download).resolves.toMatchObject({ version: "1.0.0" });
    await expect(services.binaryProgress?.({})).resolves.toEqual({
      downloaded: 10,
      total: 10,
      done: true,
    });
  });

  test("repopulates live sessions from recovered durable running state", async () => {
    const { root, services, recover, coordinator } = await fixture();
    const state = {
      version: 1,
      profile_id: "profile-recovered",
      run_id: "0123456789abcdef0123456789abcdef",
      start_key: "start-key",
      stop_key: null,
      remote_session_id: "session-recovered",
      archive: null,
      archive_artifact: null,
      work_dir: join(root, "work"),
      cache_dir: join(root, "cache"),
      launch_file: null,
      runner_pid: 42,
      runner_start_time: "1000",
      runner_cmdline_hash: "a".repeat(64),
      license_acquired: false,
      archive_materialized: true,
      browser_launched: true,
      relay_cdp_url: "ws://127.0.0.1:43123/",
      uploaded_storage_id: null,
      stop_payload: null,
      retry_count: 0,
      retry_after: null,
      updated_at: "2026-08-18T00:00:00.000Z",
      status: "running" as const,
    } satisfies RecoveryState;
    await createRecoveryStore(root).save(state);
    vi.mocked(coordinator.recover).mockResolvedValue(state);
    await recover();
    await expect(services.sessionsLive?.({})).resolves.toEqual([
      expect.objectContaining({
        profile_id: "profile-recovered",
        relay_cdp_url: "ws://127.0.0.1:43123/",
      }),
    ]);
  });
});
