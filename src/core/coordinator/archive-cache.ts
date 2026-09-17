import type { ArchiveIdentity } from "../../shared/api-types.js";
import type { TransferProgressCallback } from "../api/archive-transfer.js";
import type { SafeZipArchive } from "../archive/archive.js";
import {
  ProfileArchiveStorageError,
  type ProfileArchiveCache,
  type ProfileArchiveReference,
} from "../archive/profile-cache.js";

export type CoordinatorArchiveCache = Pick<
  ProfileArchiveCache,
  "resolve" | "publish" | "remove"
>;

export type CoordinatorArchiveCacheContext = Readonly<{
  cache: CoordinatorArchiveCache;
  appOrigin: string;
}>;

type ArchiveDownloader = {
  downloadArchive(
    identity: ArchiveIdentity,
    destination: string,
    signal?: AbortSignal,
    onProgress?: TransferProgressCallback,
  ): Promise<string>;
};

type RestoreProfileArchiveOptions = Readonly<{
  cache?: CoordinatorArchiveCacheContext;
  api: ArchiveDownloader;
  archive: SafeZipArchive;
  identity: ArchiveIdentity;
  downloadPath: string;
  workDir: string;
  onProgress?: TransferProgressCallback;
}>;

export function profileArchiveReference(
  context: CoordinatorArchiveCacheContext,
  identity: Pick<
    ArchiveIdentity,
    "profile_id" | "generation" | "size" | "sha256"
  >,
): ProfileArchiveReference {
  return {
    appOrigin: context.appOrigin,
    profileId: identity.profile_id,
    generation: identity.generation,
    size: identity.size,
    sha256: identity.sha256,
    format: "zip",
  };
}

export async function restoreProfileArchive(
  options: RestoreProfileArchiveOptions,
): Promise<void> {
  let invalidEntry = false;
  const reference = options.cache
    ? profileArchiveReference(options.cache, options.identity)
    : undefined;
  if (options.cache && reference) {
    const resolved = await options.cache.cache.resolve(reference);
    switch (resolved.kind) {
      case "hit":
        try {
          await options.archive.extractAtomic(
            resolved.archivePath,
            options.workDir,
            reference,
          );
          return;
        } catch {
          await options.cache.cache.remove(reference);
        }
        break;
      case "miss":
      case "storage_error":
        break;
      case "corrupt":
        invalidEntry = true;
        break;
      default:
        resolved satisfies never;
    }
  }

  await options.api.downloadArchive(
    options.identity,
    options.downloadPath,
    undefined,
    options.onProgress,
  );
  await options.archive.extractAtomic(options.downloadPath, options.workDir, {
    size: options.identity.size,
    sha256: options.identity.sha256,
    format: "zip",
  });
  if (!options.cache || !reference) return;
  try {
    if (invalidEntry) await options.cache.cache.remove(reference);
    await options.cache.cache.publish(reference, options.downloadPath);
  } catch (error) {
    if (!(error instanceof ProfileArchiveStorageError)) throw error;
  }
}
