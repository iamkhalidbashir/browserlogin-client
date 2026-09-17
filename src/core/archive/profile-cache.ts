import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { BrowserLoginError } from "../../shared/errors.js";
import { validateAppOrigin } from "../config/origin.js";
import { posixPathSecurity } from "../config/paths.js";
import type { PathSecurity } from "../config/paths.js";
import { atomicWriteJson } from "../config/store.js";
import { SafeZipArchive } from "./archive.js";
import {
  nodeErrorCode,
  ProfileArchiveFiles,
  ProfileArchiveStorageError,
  storageError,
} from "./profile-cache-files.js";

export { ProfileArchiveStorageError } from "./profile-cache-files.js";

const SHA256 = /^[a-f0-9]{64}$/;
const MetadataSchema = z
  .object({
    schema_version: z.literal(1),
    app_origin: z.string(),
    profile_id: z.string().min(1),
    generation: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(SHA256),
    format: z.literal("zip"),
    archive_file: z.string().regex(/^\d+-[a-f0-9]{64}\.zip$/),
  })
  .strict();

export type ProfileArchiveMetadata = Readonly<z.infer<typeof MetadataSchema>>;
export type ProfileArchiveReference = Readonly<{
  appOrigin: string;
  profileId: string;
  generation: number;
  size: number;
  sha256: string;
  format: "zip";
}>;
export type ProfileArchiveSubject = Pick<
  ProfileArchiveReference,
  "appOrigin" | "profileId"
>;
export type ProfileArchiveResolveResult =
  | Readonly<{
      kind: "hit";
      archivePath: string;
      reference: ProfileArchiveReference;
    }>
  | { readonly kind: "miss"; readonly reason: "absent" }
  | { readonly kind: "corrupt"; readonly error: ProfileArchiveCorruptionError }
  | {
      readonly kind: "storage_error";
      readonly error: ProfileArchiveStorageError;
    };

export type ProfileArchiveFaultPoint =
  "before-pointer-commit" | "before-cleanup";
export type ProfileArchiveCacheOptions = {
  readonly security?: PathSecurity;
  readonly archive?: SafeZipArchive;
  readonly faultInjector?: (
    point: ProfileArchiveFaultPoint,
  ) => Promise<void> | void;
};

export class ProfileArchiveCorruptionError extends BrowserLoginError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "PROFILE_ARCHIVE_CACHE_CORRUPT", options);
  }
}

function canonicalReference(
  reference: ProfileArchiveReference,
): ProfileArchiveReference {
  if (
    !Number.isSafeInteger(reference.generation) ||
    reference.generation < 0 ||
    !Number.isSafeInteger(reference.size) ||
    reference.size < 0 ||
    !SHA256.test(reference.sha256) ||
    reference.format !== "zip" ||
    reference.profileId.length === 0
  ) {
    throw new TypeError("invalid profile archive reference");
  }
  return { ...reference, appOrigin: validateAppOrigin(reference.appOrigin) };
}

export class ProfileArchiveCache {
  private readonly security: PathSecurity;
  private readonly archive: SafeZipArchive;
  private readonly faultInjector?: ProfileArchiveCacheOptions["faultInjector"];
  private readonly files: ProfileArchiveFiles;

  constructor(root: string, options: ProfileArchiveCacheOptions = {}) {
    this.security = options.security ?? posixPathSecurity();
    this.archive = options.archive ?? new SafeZipArchive();
    this.faultInjector = options.faultInjector;
    this.files = new ProfileArchiveFiles(root, this.security);
  }

  async publish(
    requested: ProfileArchiveReference,
    sourcePath: string,
  ): Promise<void> {
    const reference = canonicalReference(requested);
    try {
      const { directory, archiveFile } = await this.files.publishArchive(
        reference,
        sourcePath,
        this.archive,
      );
      await this.faultInjector?.("before-pointer-commit");
      const metadata: ProfileArchiveMetadata = {
        schema_version: 1,
        app_origin: reference.appOrigin,
        profile_id: reference.profileId,
        generation: reference.generation,
        size: reference.size,
        sha256: reference.sha256,
        format: "zip",
        archive_file: archiveFile,
      };
      await atomicWriteJson(
        join(directory, "current.json"),
        metadata,
        this.security,
      );
      await this.faultInjector?.("before-cleanup");
      await this.files.cleanup(directory, archiveFile);
    } catch (error) {
      const typed = storageError(error);
      if (typed) throw typed;
      throw error;
    }
  }

  async resolve(
    requested: ProfileArchiveReference,
  ): Promise<ProfileArchiveResolveResult> {
    const reference = canonicalReference(requested);
    const directory = this.files.directory(reference);
    const pointer = join(directory, "current.json");
    try {
      await this.files.verifyNamespace(reference);
      await this.files.verifyFile(pointer);
      const raw: unknown = JSON.parse(await readFile(pointer, "utf8"));
      const metadata = MetadataSchema.parse(raw);
      const expectedFile = `${metadata.generation}-${metadata.sha256}.zip`;
      if (
        metadata.app_origin !== reference.appOrigin ||
        metadata.profile_id !== reference.profileId ||
        metadata.generation !== reference.generation ||
        metadata.size !== reference.size ||
        metadata.sha256 !== reference.sha256 ||
        metadata.format !== reference.format ||
        metadata.archive_file !== expectedFile
      )
        throw new ProfileArchiveCorruptionError(
          "profile archive metadata mismatch",
        );
      const archivePath = join(directory, metadata.archive_file);
      await this.files.verifyFile(archivePath);
      await this.archive.verifyIdentity(archivePath, metadata);
      await this.files.cleanup(directory, metadata.archive_file);
      return { kind: "hit", archivePath, reference };
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT")
        return { kind: "miss", reason: "absent" };
      const typed = storageError(error);
      if (typed) return { kind: "storage_error", error: typed };
      return {
        kind: "corrupt",
        error:
          error instanceof ProfileArchiveCorruptionError
            ? error
            : new ProfileArchiveCorruptionError(
                "profile archive cache is corrupt",
                { cause: error },
              ),
      };
    }
  }

  async remove(subject: ProfileArchiveSubject): Promise<void> {
    try {
      await this.files.remove(subject);
    } catch (error) {
      const typed = storageError(error);
      if (typed) throw typed;
      throw error;
    }
  }
}
