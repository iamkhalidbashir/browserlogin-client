import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConflictError } from "../../src/shared/errors.js";
import { SafeZipArchive } from "../../src/core/archive/index.js";
import type { LaunchTiming } from "../../src/core/launch-timing.js";
import {
  LifecycleCoordinator,
  type CoordinatorApi,
  type CoordinatorProfile,
  type CrashPoint,
} from "../../src/core/coordinator/index.js";
import {
  createRecoveryStore,
  profileStatePath,
  validateRecoveryState,
  type RecoveryState,
} from "../../src/core/coordinator/state.js";

const SHA = "a".repeat(64);
const profile = {
  id: "profile-1",
  name: "test",
  seed: 1,
  platform: "macos",
  geoip: true,
  humanize: true,
  human_preset: "careful",
  bumblebee_profile: "natural",
  headless: true,
  timezone: null,
  locale: null,
  user_agent: null,
  viewport: null,
  args: [],
  proxy: null,
  cloud: {},
} as CoordinatorProfile["profile"];
const launchSpec = {
  profile_id: "profile-1",
  seed: 1,
  platform: "macos" as const,
  geoip: true,
  humanize: true,
  human_preset: "careful" as const,
  bumblebee_profile: "natural" as const,
  headless: true,
  timezone: null,
  locale: null,
  user_agent: null,
  viewport: null,
  args: [],
  proxy: null,
};

class RestoreArchive extends SafeZipArchive {
  override async extractAtomic(
    _archive: string,
    destination: string,
  ): Promise<void> {
    await mkdir(destination, { recursive: true, mode: 0o700 });
  }
}

let roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
  roots = [];
});

async function setup(
  options: {
    paid?: boolean;
    upload?: "ok" | "ambiguous" | "conflict" | "conflict-once";
    forceConflict?: boolean;
    crashPoint?: CrashPoint;
    mutateAfterUploadPending?: boolean;
    stopGeneration?: number;
    archiveOnStart?: boolean;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "browserlogin-coordinator-"));
  roots.push(root);
  let starts = 0;
  let uploads = 0;
  let stops = 0;
  let releases = 0;
  let runtimeStops = 0;
  let conflictAttempts = 0;
  let runnerStops = 0;
  let normalClose: (() => Promise<void>) | undefined;
  let adoptedArchive: string | undefined;
  let remoteStopped = false;
  const stopGeneration =
    "stopGeneration" in options ? options.stopGeneration : 1;
  const api: CoordinatorApi = {
    async startSession(profileId, key) {
      starts += 1;
      expect(profileId).toBe("profile-1");
      expect(key).toMatch(/^start-/);
      return {
        session: {
          id: "session-1",
          profile_id: profileId,
          generation: 1,
          state: "active",
        },
        profile,
        archive: options.archiveOnStart
          ? {
              profile_id: profileId,
              generation: 1,
              size: 4,
              sha256: SHA,
              format: "zip",
            }
          : null,
      } as never;
    },
    async downloadArchive(_identity, destination) {
      if (!options.archiveOnStart)
        throw new Error("archive download should not be used in this fixture");
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, "data");
      return destination;
    },
    async requestUploadUrl() {
      return {
        upload_url: "https://upload.test/1",
        session_id: "session-1",
        expires_at: "2099-01-01T00:00:00.000Z",
      };
    },
    async directUpload(_grant, path, uploadOptions) {
      uploads += 1;
      const bytes = await readFile(path);
      expect(bytes.byteLength).toBe(uploadOptions.expectedSize);
      expect(uploadOptions.expectedSha256).toHaveLength(64);
      if (options.upload === "ambiguous")
        throw new Error("simulated upload transport loss");
      return "storage-1";
    },
    async stopSession(_sessionId, _archive, key) {
      stops += 1;
      if (
        options.upload === "conflict" ||
        (options.upload === "conflict-once" && conflictAttempts++ === 0)
      )
        throw new ConflictError("server rejected generation");
      expect(key).toMatch(/^stop-/);
      return {
        id: "session-1",
        profile_id: "profile-1",
        generation: 1,
        state: "stopped",
        status: "stopped",
        ...(stopGeneration === undefined
          ? {}
          : { archive_generation: stopGeneration }),
      } as never;
    },
    async forceStopSession() {
      if (options.forceConflict)
        throw new ConflictError("server rejected force generation");
      return {
        id: "session-1",
        profile_id: "profile-1",
        generation: 1,
        state: "stopped",
        status: "stopped",
      } as never;
    },
    async sessionStatus() {
      return {
        id: "session-1",
        profile_id: "profile-1",
        generation: 1,
        state: remoteStopped ? "stopped" : "active",
        status: remoteStopped ? "stopped" : "active",
        ...(remoteStopped && stopGeneration !== undefined
          ? { archive_generation: stopGeneration }
          : {}),
      } as never;
    },
  };
  const coordinator = new LifecycleCoordinator({
    root,
    api,
    profile: async () => ({
      profile,
      launchSpec,
      binary: { path: "/fake/cloakbrowser", source: "custom" } as never,
    }),
    license: options.paid
      ? {
          key: "paid-only-test-key",
          acquire: async () => "http://license:4290",
          release: async () => {
            releases += 1;
          },
        }
      : undefined,
    runner: async (runnerOptions) => {
      normalClose = runnerOptions.onNormalStop;
      return {
        identity: { pid: 4321, process_start_time: "1000", cmdline_hash: SHA },
        relayCdpUrl: "ws://127.0.0.1:43123/",
        stop: async () => {
          runnerStops += 1;
        },
        closed: new Promise(() => undefined),
      };
    },
    ...(options.archiveOnStart ? { archive: new RestoreArchive() } : {}),
    adoptArchive: async (_profileId, artifact, generation) => {
      adoptedArchive = join(root, `adopted-${generation}.zip`);
      await copyFile(artifact, adoptedArchive);
    },
    runtimeStop: async (profileId) => {
      expect(profileId).toBe("profile-1");
      runtimeStops += 1;
    },
    crashInjector: async (point, state) => {
      if (point !== options.crashPoint) return;
      remoteStopped = true;
      if (options.mutateAfterUploadPending && state.archive_artifact)
        await writeFile(state.archive_artifact, "tampered");
      throw new Error(`test crash at ${point}`);
    },
  });
  return {
    root,
    coordinator,
    counts: () => ({
      starts,
      uploads,
      stops,
      releases,
      runtimeStops,
      runnerStops,
      adoptedArchive,
    }),
    closeBrowser: async () => {
      if (!normalClose) throw new Error("runner normal-close callback missing");
      await normalClose();
    },
  };
}

describe("Task 18 recovery state", () => {
  it("records ordered coordinator stages when an archive is restored", async () => {
    // Given
    const stages: string[] = [];
    const timing: LaunchTiming = { mark: (stage) => stages.push(stage) };
    const { coordinator } = await setup({ archiveOnStart: true });

    // When
    await coordinator.start("profile-1", timing);

    // Then
    expect(stages).toEqual([
      "profile-binary-preparation",
      "remote-session-start",
      "archive-download-restore",
    ]);
  });

  it("omits archive timing when the remote session has no archive", async () => {
    // Given
    const stages: string[] = [];
    const timing: LaunchTiming = { mark: (stage) => stages.push(stage) };
    const { coordinator } = await setup();

    // When
    await coordinator.start("profile-1", timing);

    // Then
    expect(stages).toEqual([
      "profile-binary-preparation",
      "remote-session-start",
    ]);
  });

  it("uses the hashed per-profile path, validates every load, and rejects secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-state-"));
    roots.push(root);
    const store = createRecoveryStore(root);
    const state = {
      version: 1,
      profile_id: "profile-1",
      run_id: "0123456789abcdef0123456789abcdef",
      start_key: "start-key",
      stop_key: null,
      remote_session_id: null,
      archive: null,
      archive_artifact: null,
      work_dir: join(root, "work"),
      cache_dir: join(root, "cache"),
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
      updated_at: "2026-01-01T00:00:00.000Z",
      status: "start-intent" as const,
    } satisfies RecoveryState;
    await store.save(state);
    const persistedPath = profileStatePath(root, "profile-1");
    expect(basename(dirname(persistedPath))).toBe("state");
    expect(basename(persistedPath)).toMatch(/^[0-9a-f]{64}\.json$/);
    expect(await store.load("profile-1")).toEqual(state);
    await expect(
      store.save({
        ...state,
        stop_payload: { license_key: "secret" },
      } as never),
    ).rejects.toThrow("forbidden");
  });

  it("runs paid start and happy start-stop exactly once", async () => {
    const { coordinator, counts } = await setup({ paid: true });
    const started = await coordinator.start("profile-1");
    expect(started.status).toBe("running");
    expect(started.relay_cdp_url).toBe("ws://127.0.0.1:43123/");
    await coordinator.start("profile-1");
    const stopped = await coordinator.stop("profile-1");
    expect(stopped.status).toBe("stopped");
    expect(counts()).toMatchObject({
      starts: 1,
      uploads: 1,
      stops: 1,
      releases: 1,
    });
    expect(await stat(counts().adoptedArchive!)).toBeTruthy();
  });

  it("archives and remotely stops exactly once after a native browser close", async () => {
    const fixture = await setup({ paid: true });
    await fixture.coordinator.start("profile-1");

    await fixture.closeBrowser();

    expect(fixture.counts()).toMatchObject({
      uploads: 1,
      stops: 1,
      releases: 1,
      runnerStops: 0,
    });
    expect(await fixture.coordinator.store.load("profile-1")).toBeNull();
    expect(await stat(fixture.counts().adoptedArchive!)).toBeTruthy();
  });

  it("preserves ambiguous upload recovery after a native browser close", async () => {
    const fixture = await setup({ upload: "ambiguous" });
    await fixture.coordinator.start("profile-1");

    await expect(fixture.closeBrowser()).rejects.toThrow(
      "simulated upload transport loss",
    );
    await expect(fixture.closeBrowser()).rejects.toThrow("unresolved");

    expect(fixture.counts()).toMatchObject({
      uploads: 1,
      stops: 0,
      runnerStops: 0,
    });
    await expect(
      fixture.coordinator.store.load("profile-1"),
    ).resolves.toMatchObject({
      status: "upload-ambiguous",
    });
  });

  it("does not set paid-only license behavior for a keyless start", async () => {
    const { coordinator, counts } = await setup();
    await coordinator.start("profile-1");
    expect(counts().releases).toBe(0);
  });

  it("rolls back a confirmed prelaunch remote session without an archive", async () => {
    const { coordinator, counts } = await setup({
      crashPoint: "after-remote-active-save",
    });
    await expect(coordinator.start("profile-1")).rejects.toThrow("test crash");
    const rolledBack = await coordinator.rollbackStart("profile-1");
    expect(rolledBack.status).toBe("stopped");
    expect(counts()).toMatchObject({
      starts: 1,
      uploads: 0,
      stops: 1,
      runtimeStops: 1,
    });
    expect(await coordinator.store.load("profile-1")).toBeNull();
  });

  it.each([
    "start-intent",
    "license",
    "remote-active",
    "archive_materialized",
    "spawn-intent",
    "running",
    "archive-ready",
    "upload-pending",
  ] as const)(
    "accepts isolated persisted crash cut point %s",
    async (status) => {
      const root = await mkdtemp(join(tmpdir(), "browserlogin-cutpoint-"));
      roots.push(root);
      const state = {
        version: 1,
        profile_id: "profile-1",
        run_id: "0123456789abcdef0123456789abcdef",
        start_key: "start-key",
        remote_session_id:
          status === "start-intent" || status === "license"
            ? null
            : "session-1",
        archive: null,
        archive_artifact:
          status === "upload-pending" ? join(root, "archive.zip") : null,
        work_dir: join(root, "work"),
        cache_dir: join(root, "cache"),
        launch_file: null,
        runner_pid: status === "running" ? 4321 : null,
        runner_start_time: status === "running" ? "1000" : null,
        runner_cmdline_hash: status === "running" ? SHA : null,
        license_acquired: status !== "start-intent",
        archive_materialized: [
          "archive_materialized",
          "spawn-intent",
          "running",
          "archive-ready",
          "upload-pending",
        ].includes(status),
        browser_launched: status === "running",
        uploaded_storage_id: null,
        stop_payload: status === "upload-pending" ? {} : null,
        retry_count: 0,
        retry_after: null,
        updated_at: "2026-01-01T00:00:00.000Z",
        status,
        stop_key: status === "upload-pending" ? "stop-key" : null,
      } as RecoveryState;
      expect(() => validateRecoveryState(state)).not.toThrow();
    },
  );

  it("preserves artifacts and rejects normal stop after ambiguous upload", async () => {
    const fixture = await setup({ upload: "ambiguous" });
    await fixture.coordinator.start("profile-1");
    await expect(fixture.coordinator.stop("profile-1")).rejects.toThrow(
      "simulated upload transport loss",
    );
    await expect(fixture.coordinator.stop("profile-1")).rejects.toThrow(
      "unresolved",
    );
    await fixture.coordinator.resolveUploadAmbiguous("profile-1", "storage-1");
    await fixture.coordinator.stop("profile-1");
    expect(fixture.counts().uploads).toBe(1);
    expect(fixture.counts().stops).toBe(1);
  });

  it("surfaces a committed-generation conflict and keeps recovery state", async () => {
    const fixture = await setup({ upload: "conflict" });
    await fixture.coordinator.start("profile-1");
    await expect(fixture.coordinator.stop("profile-1")).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await fixture.coordinator.store.load("profile-1")).not.toBeNull();
  });

  it("resumes a persisted post-upload stop without uploading twice", async () => {
    const fixture = await setup({ upload: "conflict-once" });
    await fixture.coordinator.start("profile-1");
    await expect(fixture.coordinator.stop("profile-1")).rejects.toBeInstanceOf(
      ConflictError,
    );
    await fixture.coordinator.stop("profile-1");
    expect(fixture.counts().uploads).toBe(1);
    expect(fixture.counts().stops).toBe(2);
  });

  it("force-stops without uploading or mutating the cache", async () => {
    const fixture = await setup();
    await fixture.coordinator.start("profile-1");
    const cache = join(fixture.root, "browser-cache", "sentinel");
    await writeFile(cache, "previous-cache");
    const result = await fixture.coordinator.forceStop("profile-1");
    expect(result.status).toBe("stopped");
    expect(await readFile(cache, "utf8")).toBe("previous-cache");
    expect(fixture.counts().uploads).toBe(0);
  });

  it("force-stops a persisted Python upload-pending session", async () => {
    const fixture = await setup();
    await fixture.coordinator.store.ensure();
    await writeFile(
      profileStatePath(fixture.root, "profile-1"),
      JSON.stringify({
        profile_id: "profile-1",
        run_id: "0123456789abcdef0123456789abcdef",
        start_key: "start-key",
        stop_key: null,
        remote_session_id: "session-1",
        archive: {
          profile_id: "profile-1",
          generation: 1,
          size: 10,
          sha256: SHA,
          format: "zip",
        },
        pending_archive_artifact: join(fixture.root, "artifacts", "legacy.zip"),
        launch_file: null,
        runner_pid: null,
        runner_create_time: null,
        license_acquired: false,
        archive_materialized: true,
        browser_launched: false,
        uploaded_storage_id: null,
        stop_payload: null,
        status: "upload-pending",
      }),
      { mode: 0o600 },
    );

    const result = await fixture.coordinator.forceStop("profile-1");

    expect(result.status).toBe("stopped");
    expect(fixture.counts().uploads).toBe(0);
    expect(await fixture.coordinator.store.load("profile-1")).toBeNull();
  });

  it("releases a paid lease after force-stop intent teardown", async () => {
    const fixture = await setup({ paid: true });
    await fixture.coordinator.start("profile-1");
    await fixture.coordinator.forceStop("profile-1");
    expect(fixture.counts().releases).toBe(1);
    expect(fixture.counts().uploads).toBe(0);
  });

  it("surfaces force-stop generation conflicts without cleanup", async () => {
    const fixture = await setup({ paid: true, forceConflict: true });
    await fixture.coordinator.start("profile-1");
    await expect(
      fixture.coordinator.forceStop("profile-1"),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await fixture.coordinator.store.load("profile-1")).not.toBeNull();
    const digestFixture = await setup({
      crashPoint: "after-upload-pending-save-before-stop",
      mutateAfterUploadPending: true,
    });
    await digestFixture.coordinator.start("profile-1");
    await expect(digestFixture.coordinator.stop("profile-1")).rejects.toThrow(
      "test crash",
    );
    await expect(
      digestFixture.coordinator.recover("profile-1"),
    ).rejects.toThrow("artifact");
    expect(
      await digestFixture.coordinator.store.load("profile-1"),
    ).not.toBeNull();
    const generationFixture = await setup({
      crashPoint: "after-upload-pending-save-before-stop",
      stopGeneration: undefined,
    });
    await generationFixture.coordinator.start("profile-1");
    await expect(
      generationFixture.coordinator.stop("profile-1"),
    ).rejects.toThrow("test crash");
    await expect(
      generationFixture.coordinator.recover("profile-1"),
    ).rejects.toThrow("archive generation");
    expect(
      await generationFixture.coordinator.store.load("profile-1"),
    ).not.toBeNull();
  }, 15_000);
});
