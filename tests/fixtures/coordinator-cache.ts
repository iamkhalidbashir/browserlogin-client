import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ProfileArchiveCache,
  type ProfileArchiveReference,
  type ProfileArchiveResolveResult,
  type ProfileArchiveStorageError,
} from "../../src/core/archive/index.js";
import type { TransferProgress } from "../../src/core/api/archive-transfer.js";
import {
  LifecycleCoordinator,
  type CoordinatorApi,
  type CoordinatorArchiveCache,
  type CoordinatorProfile,
} from "../../src/core/coordinator/index.js";
import { TestCoordinatorArchive } from "./coordinator-cache-archive.js";

export const ORIGIN = "https://cache.test";
export const PROFILE_ID = "profile-1";
const DOWNLOAD_BYTES = Buffer.from("downloaded-archive");
export const identity = {
  profile_id: PROFILE_ID,
  generation: 4,
  size: DOWNLOAD_BYTES.byteLength,
  sha256: createHash("sha256").update(DOWNLOAD_BYTES).digest("hex"),
  format: "zip" as const,
};
const profile = {
  id: PROFILE_ID,
  name: "cache-test",
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
  profile_id: PROFILE_ID,
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

type FixtureOptions = {
  readonly remoteArchive?:
    typeof identity | null | ((start: number) => typeof identity | null);
  readonly cacheResult?: ProfileArchiveResolveResult;
  readonly downloadFailure?: Error;
  readonly publishFailure?: ProfileArchiveStorageError;
  readonly realCache?: boolean;
  readonly downloadBytes?: Buffer;
};

const roots: string[] = [];
export async function cleanupCoordinatorCacheFixtures(): Promise<void> {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
  roots.length = 0;
}

export async function setupCoordinatorCache(options: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "browserlogin-coordinator-cache-"));
  roots.push(root);
  const archive = new TestCoordinatorArchive();
  const downloads: ProfileArchiveReference[] = [];
  const published: Array<{ reference: ProfileArchiveReference; path: string }> =
    [];
  const removed: Array<{ appOrigin: string; profileId: string }> = [];
  const progress: Array<{ profileId: string; value: TransferProgress }> = [];
  let starts = 0;
  let uploads = 0;
  let stops = 0;
  let releaseStart: (() => void) | undefined;
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  let gateStarts = false;
  const fakeCache: CoordinatorArchiveCache = {
    resolve: async () =>
      options.cacheResult ?? { kind: "miss", reason: "absent" },
    publish: async (reference, path) => {
      if (options.publishFailure) throw options.publishFailure;
      published.push({ reference, path });
    },
    remove: async (subject) => {
      removed.push(subject);
    },
  };
  const storedCache = new ProfileArchiveCache(root, { archive });
  const cache: CoordinatorArchiveCache = options.realCache
    ? {
        resolve: (reference) => storedCache.resolve(reference),
        publish: async (reference, path) => {
          await storedCache.publish(reference, path);
          published.push({ reference, path });
        },
        remove: async (subject) => {
          await storedCache.remove(subject);
          removed.push(subject);
        },
      }
    : fakeCache;
  const api: CoordinatorApi = {
    async startSession(profileId) {
      starts += 1;
      if (gateStarts) await startGate;
      return {
        session: {
          id: `session-${starts}`,
          profile_id: profileId,
          generation: starts,
          state: "active",
        },
        profile,
        archive:
          typeof options.remoteArchive === "function"
            ? options.remoteArchive(starts)
            : options.remoteArchive === undefined
              ? identity
              : options.remoteArchive,
      };
    },
    async downloadArchive(requested, destination, _signal, onProgress) {
      downloads.push({
        appOrigin: ORIGIN,
        profileId: requested.profile_id,
        generation: requested.generation,
        size: requested.size,
        sha256: requested.sha256,
        format: "zip",
      });
      onProgress?.({
        direction: "download",
        transferred: 0,
        total: requested.size,
        done: false,
      });
      if (options.downloadFailure) throw options.downloadFailure;
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, options.downloadBytes ?? DOWNLOAD_BYTES);
      onProgress?.({
        direction: "download",
        transferred: requested.size,
        total: requested.size,
        done: true,
      });
      return destination;
    },
    async requestUploadUrl() {
      return {};
    },
    async directUpload(_grant, path, uploadOptions) {
      uploads += 1;
      const bytes = await readFile(path);
      uploadOptions.onProgress?.({
        direction: "upload",
        transferred: 0,
        total: bytes.byteLength,
        done: false,
      });
      uploadOptions.onProgress?.({
        direction: "upload",
        transferred: bytes.byteLength,
        total: bytes.byteLength,
        done: true,
      });
      return "storage-1";
    },
    async stopSession(sessionId) {
      stops += 1;
      return {
        id: sessionId,
        profile_id: PROFILE_ID,
        generation: 1,
        state: "stopped",
        status: "stopped",
        archive_generation: 4,
      };
    },
    async forceStopSession(sessionId) {
      return {
        id: sessionId,
        profile_id: PROFILE_ID,
        generation: 1,
        state: "stopped",
        status: "stopped",
      };
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
    runner: async () => ({
      identity: {
        pid: 4321,
        process_start_time: "1000",
        cmdline_hash: "a".repeat(64),
      },
      stop: async () => undefined,
      closed: new Promise(() => undefined),
    }),
    archive,
    archiveCache: cache,
    appOrigin: ORIGIN,
    transferProgress: (profileId, value) => progress.push({ profileId, value }),
  });
  return {
    archive,
    cache,
    coordinator,
    downloads,
    published,
    removed,
    progress,
    counts: () => ({ starts, uploads, stops }),
    gateStarts: () => {
      gateStarts = true;
    },
    releaseStart: () => releaseStart?.(),
  };
}
