import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BrowserLoginClient } from "../../src/core/api/client.js";
import type { TransferProgress } from "../../src/core/api/archive-transfer.js";
import { ApplicationSessions } from "../../src/core/app/sessions.js";
import type {
  ApplicationCoordinatorFactoryOptions,
  LifecycleOperations,
} from "../../src/core/app/sessions.js";
import type { RecoveryState } from "../../src/core/coordinator/state.js";
import type { Session } from "../../src/shared/api-types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(
  create: (
    options: ApplicationCoordinatorFactoryOptions,
  ) => LifecycleOperations,
  connection: Readonly<{ appOrigin?: string; apiKey?: string }> = {},
) {
  const root = await mkdtemp(join(tmpdir(), "browserlogin-session-progress-"));
  roots.push(root);
  let appOrigin = connection.appOrigin ?? "https://Origin-A.Example.Test/";
  const sessions = new ApplicationSessions({
    root,
    client: async () =>
      new BrowserLoginClient({
        baseUrl: "https://api.example.test",
        credentials: async () => connection.apiKey ?? "bl_test_key",
      }),
    remoteConnection: async () => ({ appOrigin }),
    coordinatorFactory: create,
  });
  return {
    sessions,
    setOrigin: (value: string) => {
      appOrigin = value;
    },
  };
}

function lifecycle(
  overrides: Partial<LifecycleOperations> = {},
): LifecycleOperations {
  return {
    start: async (profileId) => recoveryState(profileId),
    stop: async (profileId) => session(profileId),
    forceStop: async (profileId) => session(profileId),
    recover: async () => null,
    ...overrides,
  };
}

describe("ApplicationSessions transfer progress", () => {
  test("recreates origin-scoped cache and coordinator after invalidation", async () => {
    // Given
    const constructions: ApplicationCoordinatorFactoryOptions[] = [];
    const { sessions, setOrigin } = await fixture((options) => {
      constructions.push(options);
      return lifecycle();
    });

    // When
    const first = await sessions.coordinator();
    setOrigin("https://Origin-B.Example.Test/");
    sessions.invalidate();
    const second = await sessions.coordinator();

    // Then
    expect(first).not.toBe(second);
    expect(constructions.map(({ appOrigin }) => appOrigin)).toEqual([
      "https://origin-a.example.test",
      "https://origin-b.example.test",
    ]);
    expect(constructions[0]?.archiveCache).not.toBe(
      constructions[1]?.archiveCache,
    );
  });

  test("creates no progress for a cache-hit launch", async () => {
    // Given
    const { sessions } = await fixture(() => lifecycle());

    // When
    await sessions.start("profile-cache-hit");

    // Then
    expect(sessions.transferProgressSnapshot()).toEqual([]);
  });

  test("keeps verified completion when best-effort refresh is handled", async () => {
    // Given
    const { sessions } = await fixture(({ transferProgress }) =>
      lifecycle({
        start: async (profileId) => {
          transferProgress(profileId, {
            direction: "download",
            transferred: 0,
            total: 8,
            done: false,
          });
          transferProgress(profileId, {
            direction: "download",
            transferred: 8,
            total: 8,
            done: true,
          });
          return recoveryState(profileId);
        },
      }),
    );

    // When
    await sessions.start("profile-refresh-failed");

    // Then
    expect(sessions.transferProgressSnapshot()).toEqual([
      expect.objectContaining({
        profileId: "profile-refresh-failed",
        percentage: 100,
        status: "completed",
      }),
    ]);
  });

  test("marks a rejected attempt failed at its last count and retries at zero", async () => {
    // Given
    let attempt = 0;
    let retryGate: Promise<never> | undefined;
    const { sessions } = await fixture(({ transferProgress }) =>
      lifecycle({
        start: async (profileId) => {
          attempt += 1;
          transferProgress(profileId, event("download", 0, 100));
          if (attempt === 1) {
            transferProgress(profileId, event("download", 63, 100));
            throw new Error("download failed");
          }
          retryGate = new Promise<never>(() => undefined);
          return retryGate;
        },
        stop: async (profileId) => {
          transferProgress(profileId, event("upload", 0, 100));
          transferProgress(profileId, event("upload", 20, 100));
          return session(profileId);
        },
      }),
    );
    await sessions.stop("profile-b");

    // When
    await expect(sessions.start("profile-a")).rejects.toThrow(
      "download failed",
    );
    const failed = sessions.transferProgressSnapshot();
    void sessions.start("profile-a");

    // Then
    expect(failed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: "profile-a",
          transferred: 63,
          status: "failed",
        }),
        expect.objectContaining({
          profileId: "profile-b",
          transferred: 20,
          status: "running",
        }),
      ]),
    );
    await vi.waitFor(() =>
      expect(sessions.transferProgressSnapshot()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            profileId: "profile-a",
            transferred: 0,
            status: "running",
          }),
          expect.objectContaining({
            profileId: "profile-b",
            transferred: 20,
            status: "running",
          }),
        ]),
      ),
    );
  });

  test("does not expose connection secrets in progress snapshots", async () => {
    // Given
    const apiKey = "bl_secret_api_key";
    const rawOrigin = "https://private-origin.example.test";
    const { sessions } = await fixture(
      ({ transferProgress }) =>
        lifecycle({
          stop: async (profileId) => {
            transferProgress(profileId, event("upload", 0, 1));
            return session(profileId);
          },
        }),
      { apiKey, appOrigin: rawOrigin },
    );

    // When
    await sessions.stop("profile-safe");
    const serialized = JSON.stringify(sessions.transferProgressSnapshot());

    // Then
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(rawOrigin);
  });
});

function event(
  direction: TransferProgress["direction"],
  transferred: number,
  total: number,
): TransferProgress {
  return { direction, transferred, total, done: false };
}

function recoveryState(profileId: string): RecoveryState {
  return {
    version: 1,
    profile_id: profileId,
    run_id: "0123456789abcdef0123456789abcdef",
    start_key: "start-key",
    stop_key: null,
    remote_session_id: null,
    archive: null,
    archive_artifact: null,
    work_dir: "/tmp/work",
    cache_dir: "/tmp/cache",
    launch_file: null,
    runner_pid: null,
    runner_start_time: null,
    runner_cmdline_hash: null,
    license_acquired: false,
    archive_materialized: false,
    browser_launched: false,
    uploaded_storage_id: null,
    stop_payload: null,
    retry_count: 0,
    retry_after: null,
    updated_at: "2026-09-18T00:00:00.000Z",
    status: "start-intent",
  };
}

function session(profileId: string): Session {
  return {
    id: `session-${profileId}`,
    profile_id: profileId,
    generation: 1,
    state: "stopped",
  };
}
