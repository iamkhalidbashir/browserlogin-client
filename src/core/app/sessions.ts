import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { BrowserLoginClient } from "../api/client.js";
import {
  BrowserInitializationRequiredError,
  readActiveBinary,
} from "../binary/index.js";
import { statePaths } from "../config/paths.js";
import { validateAppOrigin } from "../config/origin.js";
import { LifecycleCoordinator } from "../coordinator/index.js";
import { ProfileArchiveCache } from "../archive/index.js";
import type { CoordinatorArchiveCache } from "../coordinator/index.js";
import type { TransferProgress } from "../api/archive-transfer.js";
import type { RecoveryState } from "../coordinator/state.js";
import { ApplicationOperationError } from "./contracts.js";
import { createLaunchTiming } from "../launch-timing.js";
import { profileLaunchSpec } from "./profile-launch.js";
import type { Session } from "../../shared/api-types.js";
import {
  SessionTransferProgressStore,
  type SessionTransferProgressSnapshot,
} from "./session-transfer-progress.js";

export type LifecycleOperations = Pick<
  LifecycleCoordinator,
  "start" | "stop" | "forceStop" | "recover"
>;

export type ApplicationCoordinatorFactoryOptions = Readonly<{
  client: BrowserLoginClient;
  appOrigin: string;
  archiveCache: CoordinatorArchiveCache;
  transferProgress: (profileId: string, progress: TransferProgress) => void;
}>;

type ApplicationSessionsOptions = {
  readonly root: string;
  readonly client: () => Promise<BrowserLoginClient>;
  readonly remoteConnection?: () => Promise<{ readonly appOrigin: string }>;
  readonly coordinator?: LifecycleOperations;
  readonly coordinatorFactory?: (
    options: ApplicationCoordinatorFactoryOptions,
  ) => LifecycleOperations;
};

const persistedProfile = z.object({ profile_id: z.string() }).passthrough();

export class ApplicationSessions {
  private readonly live = new Map<string, RecoveryState>();
  private readonly transferProgress = new SessionTransferProgressStore();
  private coordinatorPromise: Promise<LifecycleOperations> | undefined;
  private runtimeStop: ((profileId: string) => Promise<void>) | undefined;

  constructor(private readonly options: ApplicationSessionsOptions) {}

  invalidate(): void {
    if (!this.options.coordinator) this.coordinatorPromise = undefined;
  }

  setRuntimeStop(stop: (profileId: string) => Promise<void>): void {
    this.runtimeStop = stop;
  }

  async coordinator(): Promise<LifecycleOperations> {
    if (this.options.coordinator) return this.options.coordinator;
    this.coordinatorPromise ??= this.createCoordinator();
    return this.coordinatorPromise;
  }

  async loadState(profileId: string): Promise<RecoveryState | null> {
    const coordinator = await this.coordinator();
    return coordinator instanceof LifecycleCoordinator
      ? coordinator.store.load(profileId)
      : (this.live.get(profileId) ?? null);
  }

  async start(profileId: string): Promise<RecoveryState> {
    const timing = createLaunchTiming({ env: process.env });
    const coordinator = await this.coordinator();
    try {
      const state = await coordinator.start(profileId, timing);
      this.live.set(profileId, state);
      return state;
    } catch (error) {
      this.transferProgress.fail(profileId, "download");
      throw error;
    }
  }

  async stop(profileId: string): Promise<Session> {
    try {
      const state = await (await this.coordinator()).stop(profileId);
      this.live.delete(profileId);
      return state;
    } catch (error) {
      this.transferProgress.fail(profileId, "upload");
      throw error;
    }
  }

  async forceStop(profileId: string, confirmation?: string): Promise<Session> {
    if (
      confirmation !== undefined &&
      confirmation !== `FORCE CLOSE ${profileId}`
    )
      throw new ApplicationOperationError(
        "CONFIRMATION_REQUIRED",
        "confirmation mismatch",
        false,
      );
    const state = await (await this.coordinator()).forceStop(profileId);
    this.live.delete(profileId);
    return state;
  }

  async listLive(): Promise<readonly RecoveryState[]> {
    const lifecycle = await this.coordinator();
    const recovered = await Promise.all(
      [...this.live.keys()].map(async (profileId) => ({
        profileId,
        state: await lifecycle.recover(profileId),
      })),
    );
    for (const { profileId, state } of recovered) {
      if (state) this.live.set(profileId, state);
      else this.live.delete(profileId);
    }
    return [...this.live.values()];
  }

  transferProgressSnapshot(): readonly SessionTransferProgressSnapshot[] {
    return this.transferProgress.snapshot();
  }

  async recover(): Promise<void> {
    const directory = statePaths(this.options.root).state;
    const files = await readdir(directory).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const states = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) =>
          persistedProfile.safeParse(
            JSON.parse(await readFile(join(directory, file), "utf8")),
          ),
        ),
    );
    const lifecycle = await this.coordinator();
    for (const parsed of states) {
      if (!parsed.success) continue;
      const state = await lifecycle.recover(parsed.data.profile_id);
      if (state) this.live.set(parsed.data.profile_id, state);
      else this.live.delete(parsed.data.profile_id);
    }
  }

  private async createCoordinator(): Promise<LifecycleOperations> {
    const client = await this.options.client();
    if (!this.options.remoteConnection)
      throw new TypeError("session coordinator requires a remote connection");
    const { appOrigin: rawAppOrigin } = await this.options.remoteConnection();
    const appOrigin = validateAppOrigin(rawAppOrigin);
    const archiveCache = new ProfileArchiveCache(this.options.root);
    const transferProgress = (profileId: string, progress: TransferProgress) =>
      this.transferProgress.record(profileId, progress);
    if (this.options.coordinatorFactory)
      return this.options.coordinatorFactory({
        client,
        appOrigin,
        archiveCache,
        transferProgress,
      });
    return new LifecycleCoordinator({
      root: this.options.root,
      api: client,
      archiveCache,
      appOrigin,
      transferProgress,
      profile: async (profileId) => {
        const binary = await readActiveBinary(this.options.root, {
          env: process.env,
        });
        if (!binary) throw new BrowserInitializationRequiredError();
        const profile = await client.getProfile(profileId);
        return { profile, binary, launchSpec: profileLaunchSpec(profile) };
      },
      runtimeStop: async (profileId) => this.runtimeStop?.(profileId),
    });
  }
}
