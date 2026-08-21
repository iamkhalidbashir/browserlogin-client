import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BrowserLoginError } from "../../shared/errors.js";
import type {
  ArchiveIdentity,
  Profile,
  Session,
  StartResponse,
} from "../../shared/api-types.js";
import { SafeZipArchive } from "../archive/index.js";
import { ensureBinary, type BinaryInfo } from "../binary/index.js";
import { launchRunner } from "../runner/supervisor.js";
import type { LaunchSpec, RunnerPaths } from "../runner/types.js";
import {
  assertIdentity,
  killProcessTree,
  readIdentity,
  type ProcessIdentity,
} from "../processes/index.js";
import {
  createRecoveryStore,
  immutableIdempotencyKey,
  assertStatePath,
  type RecoveryState,
  type RecoveryStatus,
} from "./state.js";

const CACHE_LIMIT = 512 * 1024 * 1024;
const RECOVERY_LIMIT_MS = 30_000;

export type CoordinatorApi = {
  startSession(profileId: string, key: string): Promise<StartResponse>;
  downloadArchive(
    identity: ArchiveIdentity,
    destination: string,
  ): Promise<string>;
  requestUploadUrl(profileId: string, sessionId: string): Promise<unknown>;
  directUpload(
    grant: unknown,
    path: string,
    options: {
      expectedSize: number;
      expectedSha256: string;
      expectedSessionId: string;
    },
  ): Promise<string>;
  stopSession(
    sessionId: string,
    archive:
      | { storage_id: string; size: number; sha256: string; format: "zip" }
      | undefined,
    key: string,
  ): Promise<Session>;
  forceStopSession(sessionId: string, key: string): Promise<Session>;
  sessionStatus?(sessionId: string): Promise<Session>;
};
export type LicenseLifecycle = {
  key?: string;
  acquire(): Promise<string | undefined>;
  release(): Promise<void>;
};
export type RunnerHandle = {
  identity: { pid: number; process_start_time: string; cmdline_hash: string };
  relayCdpUrl?: string;
  stop(): Promise<void>;
  closed: Promise<unknown>;
};
export type RunnerFactory = (options: {
  spec: LaunchSpec;
  binary: BinaryInfo;
  licenseApiUrl?: string;
  paths: RunnerPaths;
  onNormalStop: () => Promise<void>;
  onSpawned?: (identity: ProcessIdentity) => Promise<void>;
  healthCallback?: () => Promise<boolean>;
}) => Promise<RunnerHandle>;
export type CrashPoint =
  | "after-start-intent-save"
  | "after-license-save"
  | "after-remote-active-save"
  | "after-archive-materialized-save"
  | "after-spawn-identity-save-before-ready"
  | "after-running-save"
  | "after-archive-ready-save"
  | "after-upload-pending-save-before-stop"
  | "after-force-stop-intent-save"
  | "after-runner-stopped-before-identity-save"
  | "after-license-released-before-state-save"
  | "after-stop-response-before-adopt";
export type CrashInjector = (
  point: CrashPoint,
  state: RecoveryState,
) => Promise<void> | void;
export type CoordinatorProfile = {
  profile: Profile;
  binary?: BinaryInfo;
  launchSpec: Omit<
    LaunchSpec,
    "user_data_dir" | "browser_cache_dir" | "browser_cache_max_bytes"
  >;
};
export type CoordinatorOptions = {
  root: string;
  api: CoordinatorApi;
  profile: (profileId: string) => Promise<CoordinatorProfile>;
  license?: LicenseLifecycle;
  runner?: RunnerFactory;
  archive?: SafeZipArchive;
  now?: () => Date;
  health?: () => Promise<boolean>;
  stopRunner?: (state: RecoveryState) => Promise<void>;
  adoptArchive?: (
    profileId: string,
    artifact: string,
    generation: number,
  ) => Promise<void>;
  runtimeStop?: (profileId: string) => Promise<void>;
  crashInjector?: CrashInjector;
};

async function digestFile(
  path: string,
): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.length;
    hash.update(chunk);
  }
  return { size, sha256: hash.digest("hex") };
}
function transition(
  state: RecoveryState,
  next: RecoveryStatus,
  now: () => Date,
): RecoveryState {
  return {
    ...state,
    status: next,
    updated_at: now().toISOString(),
  } as RecoveryState;
}

export class LifecycleCoordinator {
  readonly store;
  private readonly archive;
  private readonly now;
  private readonly runner;
  private readonly runnerHandles = new Map<string, RunnerHandle>();
  private readonly naturallyClosed = new Set<string>();
  private readonly licenseUrls = new Map<string, string>();
  private readonly crashInjector?: CrashInjector;
  constructor(private readonly options: CoordinatorOptions) {
    this.store = createRecoveryStore(options.root);
    this.archive = options.archive ?? new SafeZipArchive();
    this.now = options.now ?? (() => new Date());
    this.crashInjector = options.crashInjector;
    this.runner =
      options.runner ??
      (async (input) =>
        launchRunner({
          ...input,
          cwd: this.options.root,
          binaryPath: input.binary.path,
          licenseKey: this.options.license?.key,
        }));
  }

  async start(profileId: string): Promise<RecoveryState> {
    return this.store.withTransition(profileId, async () => {
      let state = await this.store.load(profileId);
      if (state && state.status !== "done") {
        await this.reconcileLocked(state);
        state = await this.store.load(profileId);
        if (state?.status === "running") return state;
        if (state?.status === "upload-ambiguous")
          throw new BrowserLoginError(
            "archive upload outcome is unresolved; resolve it before starting this profile again",
          );
        if (
          state &&
          state.status !== "done" &&
          (state.status === "start-intent" ||
            state.status === "license" ||
            state.status === "remote-active" ||
            state.status === "archive_materialized" ||
            state.status === "spawn-intent")
        )
          return this.startLocked(state);
      }
      if (state?.status === "done") await this.cleanupLocked(state);
      const runId = randomUUID().replaceAll("-", "");
      state = this.newState(
        profileId,
        runId,
        immutableIdempotencyKey("start", runId, {
          profile_id: profileId,
          run_id: runId,
        }),
      );
      await this.store.save(state);
      await this.crashInjector?.("after-start-intent-save", state);
      return this.startLocked(state);
    });
  }

  async stop(profileId: string): Promise<Session> {
    return this.store.withTransition(profileId, async () => {
      const state = await this.requireState(profileId);
      const reconciled = await this.reconcileLocked(state);
      if (reconciled) return reconciled;
      const current = await this.store.load(profileId);
      if (!current)
        throw new BrowserLoginError(
          "lifecycle state disappeared during reconciliation",
        );
      if (!current.remote_session_id)
        throw new BrowserLoginError(
          "force stop requires a confirmed remote session",
        );
      if (current.status === "upload-ambiguous")
        throw new BrowserLoginError(
          "archive upload outcome is unresolved; resolve it explicitly before stopping",
        );
      return this.stopLocked(current);
    });
  }

  async forceStop(profileId: string): Promise<Session> {
    return this.store.withTransition(profileId, async () => {
      let current = await this.requireState(profileId);
      if (!current.remote_session_id)
        throw new BrowserLoginError(
          "force stop requires a confirmed remote session",
        );
      if (current.status !== "force-stop") {
        current = transition(
          {
            ...current,
            stop_key: immutableIdempotencyKey("force-stop", current.run_id, {
              force: true,
            }),
            stop_payload: { force: true },
          },
          "force-stop",
          this.now,
        );
        await this.store.save(current);
        await this.crashInjector?.("after-force-stop-intent-save", current);
      }
      return this.forceStopLocked(current);
    });
  }

  async rollbackStart(profileId: string): Promise<Session> {
    return this.store.withTransition(profileId, async () => {
      const state = await this.requireState(profileId);
      if (!state.remote_session_id)
        throw new BrowserLoginError(
          "start rollback requires a confirmed remote session",
        );
      if (
        !["remote-active", "archive_materialized", "spawn-intent"].includes(
          state.status,
        )
      )
        throw new BrowserLoginError(
          "start rollback is only available before browser readiness",
        );
      await this.options.runtimeStop?.(state.profile_id);
      await this.stopRunner(state);
      if (state.license_acquired) {
        await this.options.license?.release();
        this.licenseUrls.delete(state.profile_id);
      }
      const stopKey = immutableIdempotencyKey("stop", state.run_id, {
        rollback_start: true,
      });
      const result = await this.options.api.stopSession(
        state.remote_session_id,
        undefined,
        stopKey,
      );
      if (
        result.id !== state.remote_session_id ||
        result.profile_id !== state.profile_id ||
        result.state !== "stopped" ||
        result.status !== "stopped"
      )
        throw new BrowserLoginError("start rollback was not committed");
      await this.cleanupLocked(state);
      return result;
    });
  }

  async recover(profileId: string): Promise<RecoveryState | null> {
    const deadline = Date.now() + RECOVERY_LIMIT_MS;
    return this.store.withTransition(profileId, async () => {
      let state = await this.store.load(profileId);
      while (state && Date.now() < deadline) {
        const reconciled = await this.reconcileLocked(state);
        if (reconciled) return null;
        state = await this.store.load(profileId);
        if (
          !state ||
          state.status === "done" ||
          state.status === "upload-ambiguous"
        )
          break;
        if (state.status === "force-stop") {
          await this.forceStopLocked(state);
          return null;
        }
        if (
          state.status === "upload-pending" ||
          state.status === "archive-ready"
        ) {
          await this.stopLocked(state);
          return null;
        }
        if (
          state.status === "start-intent" ||
          state.status === "license" ||
          state.status === "remote-active" ||
          state.status === "archive_materialized" ||
          state.status === "spawn-intent"
        ) {
          state = await this.startLocked(state);
          return state;
        }
        break;
      }
      if (state && Date.now() >= deadline)
        await this.store.save({
          ...state,
          retry_count: state.retry_count + 1,
          retry_after: new Date(Date.now() + 1_000).toISOString(),
          updated_at: this.now().toISOString(),
        });
      return state?.status === "done" ? null : state;
    });
  }

  async resolveUploadAmbiguous(
    profileId: string,
    storageId: string,
  ): Promise<void> {
    return this.store.withTransition(profileId, async () => {
      const state = await this.requireState(profileId);
      if (state.status !== "upload-ambiguous")
        throw new BrowserLoginError("no ambiguous upload exists");
      if (
        !state.archive ||
        !state.archive_artifact ||
        !/^[^\0\r\n]+$/.test(storageId)
      )
        throw new BrowserLoginError(
          "ambiguous upload state lacks a verifiable archive identity",
        );
      const archivePayload = {
        storage_id: storageId,
        size: state.archive.size,
        sha256: state.archive.sha256,
        format: "zip" as const,
      };
      const payload = {
        archive: archivePayload,
      };
      await this.store.save(
        transition(
          {
            ...state,
            stop_key: immutableIdempotencyKey(
              "stop",
              state.run_id,
              archivePayload,
            ),
            stop_payload: payload,
            uploaded_storage_id: storageId,
          },
          "upload-pending",
          this.now,
        ),
      );
    });
  }

  async browserProcessClosed(
    profileId: string,
    runId: string,
    runnerPid: number,
  ): Promise<Session | undefined> {
    return this.store.withTransition(profileId, async () => {
      const state = await this.store.load(profileId);
      if (
        !state ||
        state.run_id !== runId ||
        state.runner_pid !== runnerPid ||
        state.status !== "running"
      )
        return undefined;
      const next = transition(
        {
          ...state,
          runner_pid: null,
          runner_start_time: null,
          runner_cmdline_hash: null,
          browser_launched: false,
          relay_cdp_url: null,
        },
        "archive_materialized",
        this.now,
      );
      await this.store.save(next);
      return this.stopLocked(next);
    });
  }

  private newState(
    profileId: string,
    runId: string,
    startKey: string,
  ): RecoveryState {
    const root = this.options.root;
    return {
      version: 1,
      profile_id: profileId,
      run_id: runId,
      start_key: startKey,
      stop_key: null,
      remote_session_id: null,
      archive: null,
      archive_artifact: null,
      work_dir: join(root, "work", runId),
      cache_dir: join(root, "browser-cache", runId),
      launch_file: null,
      runner_pid: null,
      runner_start_time: null,
      runner_cmdline_hash: null,
      license_acquired: false,
      archive_materialized: false,
      browser_launched: false,
      relay_cdp_url: null,
      uploaded_storage_id: null,
      stop_payload: null,
      retry_count: 0,
      retry_after: null,
      updated_at: this.now().toISOString(),
      status: "start-intent",
    };
  }

  private async startLocked(initial: RecoveryState): Promise<RecoveryState> {
    let state = initial;
    const context = await this.options.profile(state.profile_id);
    const licenseApiUrl = this.options.license?.key
      ? (this.licenseUrls.get(state.profile_id) ??
        (await this.options.license.acquire()))
      : undefined;
    if (this.options.license?.key && !licenseApiUrl)
      throw new BrowserLoginError("paid start did not acquire a license relay");
    if (licenseApiUrl) this.licenseUrls.set(state.profile_id, licenseApiUrl);
    if (!state.license_acquired) {
      state = transition(
        { ...state, license_acquired: Boolean(this.options.license?.key) },
        "license",
        this.now,
      );
      await this.store.save(state);
      await this.crashInjector?.("after-license-save", state);
    }
    try {
      if (!state.remote_session_id) {
        const started = await this.options.api.startSession(
          state.profile_id,
          state.start_key,
        );
        state = transition(
          {
            ...state,
            remote_session_id: started.session.id,
            archive: started.archive
              ? {
                  generation: started.archive.generation,
                  size: started.archive.size,
                  sha256: started.archive.sha256,
                  format: "zip",
                }
              : null,
          },
          "remote-active",
          this.now,
        );
        await this.store.save(state);
        await this.crashInjector?.("after-remote-active-save", state);
      }
      await mkdir(state.work_dir, { recursive: true, mode: 0o700 });
      if (state.archive && !state.archive_materialized) {
        const download = join(
          this.options.root,
          "artifacts",
          `${state.run_id}.zip`,
        );
        await this.options.api.downloadArchive(
          {
            profile_id: state.profile_id,
            generation: state.archive.generation,
            size: state.archive.size,
            sha256: state.archive.sha256,
            format: "zip",
          },
          download,
        );
        await this.archive.extractAtomic(download, state.work_dir, {
          size: state.archive.size,
          sha256: state.archive.sha256,
          format: "zip",
        });
      }
      await mkdir(state.cache_dir, { recursive: true, mode: 0o700 });
      state = transition(
        { ...state, archive_materialized: true },
        "archive_materialized",
        this.now,
      );
      await this.store.save(state);
      await this.crashInjector?.("after-archive-materialized-save", state);
      const binary =
        context.binary ??
        (await ensureBinary({ licenseKey: this.options.license?.key }));
      const spec = {
        ...context.launchSpec,
        user_data_dir: state.work_dir,
        browser_cache_dir: state.cache_dir,
        browser_cache_max_bytes: CACHE_LIMIT,
      } as LaunchSpec;
      const paths: RunnerPaths = {
        launchFile: join(this.options.root, "launch", `${state.run_id}.json`),
        gateFile: join(this.options.root, "gates", `${state.run_id}.gate`),
        controlFile: join(
          this.options.root,
          "controls",
          `${state.run_id}.control`,
        ),
        readyFile: join(this.options.root, "ready", `${state.run_id}.ready`),
      };
      state = transition(
        { ...state, launch_file: paths.launchFile },
        "spawn-intent",
        this.now,
      );
      await this.store.save(state);
      if (state.runner_pid !== null) {
        const identity: ProcessIdentity = {
          pid: state.runner_pid,
          process_start_time: state.runner_start_time!,
          cmdline_hash: state.runner_cmdline_hash!,
        };
        try {
          await assertIdentity(identity);
          await killProcessTree(identity.pid, { recordedIdentity: identity });
        } catch (error) {
          const actual = await readIdentity(identity);
          if (actual) throw error;
        }
        state = {
          ...state,
          runner_pid: null,
          runner_start_time: null,
          runner_cmdline_hash: null,
        };
        await this.store.save(state);
      }
      const runner = await this.runner({
        spec,
        binary,
        licenseApiUrl,
        paths,
        healthCallback: this.options.health,
        onNormalStop: async () => {
          this.naturallyClosed.add(state.profile_id);
          await this.stop(state.profile_id);
        },
        onSpawned: async (identity) => {
          state = {
            ...state,
            runner_pid: identity.pid,
            runner_start_time: identity.process_start_time,
            runner_cmdline_hash: identity.cmdline_hash,
          };
          await this.store.save(state);
          await this.crashInjector?.(
            "after-spawn-identity-save-before-ready",
            state,
          );
        },
      });
      this.runnerHandles.set(state.profile_id, runner);
      void runner.closed.catch(async () => {
        try {
          await this.store.withTransition(state.profile_id, async () => {
            const current = await this.store.load(state.profile_id);
            if (current)
              await this.store.save({
                ...current,
                retry_count: current.retry_count + 1,
                retry_after: new Date(Date.now() + 1_000).toISOString(),
                updated_at: this.now().toISOString(),
              });
          });
        } catch (error) {
          void error;
        }
      });
      state = transition(
        {
          ...state,
          runner_pid: runner.identity.pid,
          runner_start_time: runner.identity.process_start_time,
          runner_cmdline_hash: runner.identity.cmdline_hash,
          browser_launched: true,
          relay_cdp_url: runner.relayCdpUrl ?? null,
        },
        "running",
        this.now,
      );
      await this.store.save(state);
      await this.crashInjector?.("after-running-save", state);
      return state;
    } catch (error) {
      await this.store.save({
        ...state,
        retry_count: state.retry_count + 1,
        retry_after: new Date(Date.now() + 1_000).toISOString(),
        updated_at: this.now().toISOString(),
      });
      throw error;
    }
  }

  private async stopLocked(input: RecoveryState): Promise<Session> {
    let state = input;
    if (!state.remote_session_id)
      throw new BrowserLoginError(
        "recovery state omitted remote session identity",
      );
    const sessionId = state.remote_session_id;
    if (state.stop_payload?.["force"] === true)
      throw new BrowserLoginError("force stop is pending; retry force stop");
    if (state.status === "done")
      throw new BrowserLoginError("session is already stopped");
    const persistedArchive = state.stop_payload?.archive;
    if (
      state.status === "upload-pending" &&
      state.stop_key &&
      persistedArchive &&
      typeof persistedArchive === "object" &&
      "storage_id" in persistedArchive &&
      "size" in persistedArchive &&
      "sha256" in persistedArchive &&
      (persistedArchive as Record<string, unknown>).format === "zip"
    ) {
      const archivePayload = persistedArchive as {
        storage_id: string;
        size: number;
        sha256: string;
        format: "zip";
      };
      const digest = await digestFile(state.archive_artifact!);
      if (
        digest.size !== archivePayload.size ||
        digest.sha256 !== archivePayload.sha256
      )
        throw new BrowserLoginError(
          "persisted upload artifact no longer matches its archive identity",
        );
      const result = await this.options.api.stopSession(
        sessionId,
        archivePayload,
        state.stop_key,
      );
      if (
        result.id !== sessionId ||
        result.profile_id !== state.profile_id ||
        result.state !== "stopped" ||
        result.status !== "stopped" ||
        typeof result.archive_generation !== "number" ||
        !Number.isInteger(result.archive_generation) ||
        result.archive_generation < 0
      )
        throw new BrowserLoginError("stop response was not committed");
      await this.crashInjector?.("after-stop-response-before-adopt", state);
      return this.adoptCommittedUploadLocked(state, result);
    }
    const hadLicense = state.license_acquired;
    state = transition(state, "archive-ready", this.now);
    await this.store.save(state);
    await this.crashInjector?.("after-archive-ready-save", state);
    await this.options.runtimeStop?.(state.profile_id);
    await this.stopRunner(state);
    await this.crashInjector?.(
      "after-runner-stopped-before-identity-save",
      state,
    );
    if (hadLicense) {
      await this.options.license?.release();
      this.licenseUrls.delete(state.profile_id);
      await this.crashInjector?.(
        "after-license-released-before-state-save",
        state,
      );
    }
    state = {
      ...state,
      runner_pid: null,
      runner_start_time: null,
      runner_cmdline_hash: null,
      browser_launched: false,
      relay_cdp_url: null,
      license_acquired: false,
      launch_file: null,
    };
    await this.store.save(state);
    const artifact =
      state.archive_artifact ??
      join(this.options.root, "artifacts", `${state.run_id}.zip`);
    await mkdir(dirname(artifact), { recursive: true, mode: 0o700 });
    if (!state.archive_artifact) {
      const identity = await this.archive.create(state.work_dir, artifact);
      state = {
        ...state,
        archive_artifact: artifact,
        archive: {
          generation: state.archive?.generation ?? 0,
          size: identity.size,
          sha256: identity.sha256,
          format: "zip",
        },
      };
      await this.store.save(state);
    }
    const digest = await digestFile(artifact);
    if (
      !state.archive ||
      digest.size !== state.archive.size ||
      digest.sha256 !== state.archive.sha256
    )
      throw new BrowserLoginError(
        "archive bytes changed after identity was persisted",
      );
    const grant = await this.options.api.requestUploadUrl(
      state.profile_id,
      sessionId,
    );
    state = transition(state, "upload-ambiguous", this.now);
    await this.store.save(state);
    let storageId: string;
    try {
      storageId = await this.options.api.directUpload(grant, artifact, {
        expectedSize: digest.size,
        expectedSha256: digest.sha256,
        expectedSessionId: sessionId,
      });
      if (
        typeof storageId !== "string" ||
        !/^[^\0\r\n]{1,256}$/.test(storageId)
      )
        throw new BrowserLoginError(
          "direct upload returned an invalid storage identity",
        );
    } catch (error) {
      await this.store.save(transition(state, "upload-ambiguous", this.now));
      throw error;
    }
    const archivePayload = {
      storage_id: storageId,
      size: digest.size,
      sha256: digest.sha256,
      format: "zip" as const,
    };
    const stopKey =
      state.stop_key ??
      immutableIdempotencyKey("stop", state.run_id, archivePayload);
    state = transition(
      {
        ...state,
        stop_key: stopKey,
        stop_payload: { archive: archivePayload },
        uploaded_storage_id: storageId,
      },
      "upload-pending",
      this.now,
    );
    await this.store.save(state);
    await this.crashInjector?.("after-upload-pending-save-before-stop", state);
    const result = await this.options.api.stopSession(
      sessionId,
      archivePayload,
      stopKey,
    );
    if (
      result.id !== sessionId ||
      result.profile_id !== state.profile_id ||
      result.state !== "stopped" ||
      result.status !== "stopped" ||
      typeof result.archive_generation !== "number" ||
      !Number.isInteger(result.archive_generation) ||
      result.archive_generation < 0
    )
      throw new BrowserLoginError("stop response was not committed");
    await this.crashInjector?.("after-stop-response-before-adopt", state);
    return this.adoptCommittedUploadLocked(state, result);
  }

  private async reconcileLocked(
    state: RecoveryState,
  ): Promise<Session | undefined> {
    const remote =
      state.remote_session_id && this.options.api.sessionStatus
        ? await this.options.api.sessionStatus(state.remote_session_id)
        : undefined;
    if (remote) {
      if (
        remote.id !== state.remote_session_id ||
        remote.profile_id !== state.profile_id
      )
        throw new BrowserLoginError(
          "remote session identity mismatch during reconciliation",
        );
      if (remote.state === "stopped" || remote.status === "stopped")
        return this.cleanupRemoteStoppedLocked(state, remote);
    }
    if (state.status === "force-stop" || state.status === "upload-ambiguous")
      return undefined;
    if (
      state.status === "running" &&
      !this.runnerHandles.has(state.profile_id) &&
      state.runner_pid !== null &&
      state.runner_start_time !== null &&
      state.runner_cmdline_hash !== null
    ) {
      const identity: ProcessIdentity = {
        pid: state.runner_pid,
        process_start_time: state.runner_start_time,
        cmdline_hash: state.runner_cmdline_hash,
      };
      try {
        await assertIdentity(identity);
        return undefined;
      } catch {
        const actual = await readIdentity(identity);
        if (actual)
          throw new BrowserLoginError(
            "persisted runner identity does not match the live process",
          );
        const next = transition(
          {
            ...state,
            runner_pid: null,
            runner_start_time: null,
            runner_cmdline_hash: null,
            browser_launched: false,
            relay_cdp_url: null,
          },
          "archive_materialized",
          this.now,
        );
        await this.store.save(next);
        return this.stopLocked(next);
      }
    }
    return undefined;
  }

  private async forceStopLocked(input: RecoveryState): Promise<Session> {
    const state = input;
    const remote =
      state.remote_session_id && this.options.api.sessionStatus
        ? await this.options.api.sessionStatus(state.remote_session_id)
        : undefined;
    if (
      remote &&
      (remote.id !== state.remote_session_id ||
        remote.profile_id !== state.profile_id)
    )
      throw new BrowserLoginError(
        "remote session identity mismatch during force stop",
      );
    if (remote?.state === "stopped" || remote?.status === "stopped")
      return this.cleanupRemoteStoppedLocked(state, remote);
    const hadLicense = state.license_acquired;
    await this.options.runtimeStop?.(state.profile_id);
    await this.stopRunner(state);
    await this.crashInjector?.(
      "after-runner-stopped-before-identity-save",
      state,
    );
    if (hadLicense) {
      await this.options.license?.release();
      this.licenseUrls.delete(state.profile_id);
      await this.crashInjector?.(
        "after-license-released-before-state-save",
        state,
      );
    }
    const cleared = {
      ...state,
      license_acquired: false,
      runner_pid: null,
      runner_start_time: null,
      runner_cmdline_hash: null,
      launch_file: null,
      browser_launched: false,
      relay_cdp_url: null,
    } as RecoveryState;
    await this.store.save(cleared);
    const result = await this.options.api.forceStopSession(
      cleared.remote_session_id!,
      cleared.stop_key!,
    );
    if (
      result.id !== cleared.remote_session_id ||
      result.profile_id !== cleared.profile_id ||
      result.state !== "stopped" ||
      result.status !== "stopped"
    )
      throw new BrowserLoginError("force stop response was not committed");
    await this.cleanupLocked(cleared, true);
    return result;
  }

  private async cleanupRemoteStoppedLocked(
    state: RecoveryState,
    remote: Session,
  ): Promise<Session> {
    if (state.status === "upload-pending")
      return this.adoptCommittedUploadLocked(state, remote);
    const hadLicense = state.license_acquired;
    await this.options.runtimeStop?.(state.profile_id);
    await this.stopRunner(state);
    await this.crashInjector?.(
      "after-runner-stopped-before-identity-save",
      state,
    );
    if (hadLicense) {
      await this.options.license?.release();
      this.licenseUrls.delete(state.profile_id);
      await this.crashInjector?.(
        "after-license-released-before-state-save",
        state,
      );
    }
    const cleared = {
      ...state,
      license_acquired: false,
      runner_pid: null,
      runner_start_time: null,
      runner_cmdline_hash: null,
      launch_file: null,
      browser_launched: false,
      relay_cdp_url: null,
      status:
        state.status === "running"
          ? ("archive_materialized" as const)
          : state.status,
    };
    await this.store.save(cleared);
    await this.cleanupLocked(cleared, true);
    return remote;
  }

  private async adoptCommittedUploadLocked(
    state: RecoveryState,
    remote: Session,
  ): Promise<Session> {
    if (
      !state.archive_artifact ||
      !state.archive ||
      !state.stop_payload ||
      typeof state.stop_payload.archive !== "object" ||
      state.stop_payload.archive === null
    )
      throw new BrowserLoginError("committed upload state is incomplete");
    if (
      typeof remote.archive_generation !== "number" ||
      !Number.isInteger(remote.archive_generation) ||
      remote.archive_generation < 0
    )
      throw new BrowserLoginError(
        "committed stop response has invalid archive generation",
      );
    const archivePayload = state.stop_payload.archive as Record<
      string,
      unknown
    >;
    const digest = await digestFile(state.archive_artifact);
    if (
      digest.size !== archivePayload.size ||
      digest.sha256 !== archivePayload.sha256
    )
      throw new BrowserLoginError(
        "committed upload artifact no longer matches its archive identity",
      );
    await this.options.adoptArchive?.(
      state.profile_id,
      state.archive_artifact,
      remote.archive_generation,
    );
    await this.store.save(transition(state, "done", this.now));
    await this.cleanupLocked({ ...state, status: "done" });
    return remote;
  }
  private async stopRunner(state: RecoveryState): Promise<void> {
    if (this.naturallyClosed.delete(state.profile_id)) {
      this.runnerHandles.delete(state.profile_id);
      return;
    }
    const handle = this.runnerHandles.get(state.profile_id);
    if (handle) {
      const actual = await readIdentity(handle.identity);
      if (
        actual &&
        (actual.process_start_time !== handle.identity.process_start_time ||
          actual.cmdline_hash !== handle.identity.cmdline_hash)
      )
        throw new BrowserLoginError(
          "runner handle identity does not match the live process",
        );
      if (actual) await handle.stop();
      this.runnerHandles.delete(state.profile_id);
    } else if (this.options.stopRunner) {
      await this.options.stopRunner(state);
    } else if (
      state.runner_pid !== null &&
      state.runner_start_time !== null &&
      state.runner_cmdline_hash !== null
    ) {
      const identity: ProcessIdentity = {
        pid: state.runner_pid,
        process_start_time: state.runner_start_time,
        cmdline_hash: state.runner_cmdline_hash,
      };
      const actual = await readIdentity(identity);
      if (!actual) return;
      if (
        actual.process_start_time !== identity.process_start_time ||
        actual.cmdline_hash !== identity.cmdline_hash
      )
        throw new BrowserLoginError(
          "persisted runner identity does not match the live process",
        );
      await killProcessTree(identity.pid, { recordedIdentity: identity });
    }
  }
  private async requireState(profileId: string): Promise<RecoveryState> {
    const state = await this.store.load(profileId);
    if (!state)
      throw new BrowserLoginError(
        "no recoverable remote session for profile identity",
      );
    return state;
  }
  private async cleanupLocked(
    state: RecoveryState,
    preserveCache = false,
  ): Promise<void> {
    await Promise.all([
      state.archive_artifact
        ? rm(assertStatePath(this.options.root, state.archive_artifact), {
            force: true,
          })
        : undefined,
      rm(assertStatePath(this.options.root, state.work_dir), {
        recursive: true,
        force: true,
      }),
      preserveCache
        ? undefined
        : rm(assertStatePath(this.options.root, state.cache_dir), {
            recursive: true,
            force: true,
          }),
      state.launch_file
        ? rm(assertStatePath(this.options.root, state.launch_file), {
            force: true,
          })
        : undefined,
      rm(join(this.options.root, "gates", `${state.run_id}.gate`), {
        force: true,
      }),
      rm(join(this.options.root, "controls", `${state.run_id}.control`), {
        force: true,
      }),
      rm(join(this.options.root, "ready", `${state.run_id}.ready`), {
        force: true,
      }),
      rm(join(this.options.root, "artifacts", `${state.run_id}.zip`), {
        force: true,
      }),
    ]);
    await this.store.remove(state.profile_id);
  }
}
