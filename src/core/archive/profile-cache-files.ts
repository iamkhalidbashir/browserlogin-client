import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { BrowserLoginError } from "../../shared/errors.js";
import { validateAppOrigin } from "../config/origin.js";
import { statePaths, type PathSecurity } from "../config/paths.js";
import type { SafeZipArchive } from "./archive.js";
import type {
  ProfileArchiveReference,
  ProfileArchiveSubject,
} from "./profile-cache.js";

const STORAGE_ERROR_CODES = new Set([
  "EACCES",
  "EPERM",
  "EIO",
  "ENOSPC",
  "EROFS",
  "EMFILE",
  "ENFILE",
]);
const UNSUPPORTED_DIRECTORY_SYNC_CODES = new Set([
  "EINVAL",
  "EISDIR",
  "ENOTSUP",
  "EPERM",
]);

export class ProfileArchiveStorageError extends BrowserLoginError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "PROFILE_ARCHIVE_CACHE_STORAGE", options);
  }
}

export function nodeErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export function storageError(
  error: unknown,
): ProfileArchiveStorageError | undefined {
  if (error instanceof ProfileArchiveStorageError) return error;
  const code = nodeErrorCode(error);
  return code && STORAGE_ERROR_CODES.has(code)
    ? new ProfileArchiveStorageError("profile archive cache storage failed", {
        cause: error,
      })
    : undefined;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!UNSUPPORTED_DIRECTORY_SYNC_CODES.has(nodeErrorCode(error) ?? ""))
      throw error;
  }
}

export class ProfileArchiveFiles {
  private readonly base: string;
  private readonly cacheRoot: string;

  constructor(
    root: string,
    private readonly security: PathSecurity,
  ) {
    this.cacheRoot = statePaths(root).cache;
    this.base = join(this.cacheRoot, "profile-archives");
  }

  directory(subject: ProfileArchiveSubject): string {
    return join(
      this.originDirectory(subject.appOrigin),
      digest(subject.profileId),
    );
  }

  private originDirectory(appOrigin: string): string {
    return join(this.base, digest(validateAppOrigin(appOrigin)));
  }

  async ensureNamespace(subject: ProfileArchiveSubject): Promise<string> {
    const origin = this.originDirectory(subject.appOrigin);
    const directory = this.directory(subject);
    await this.security.verify(this.cacheRoot, true);
    for (const path of [this.base, origin, directory]) {
      try {
        await this.security.rejectReparse?.(path);
        await mkdir(path, { mode: 0o700 });
        await this.security.secure(path, true);
        await this.security.verify(path, true);
      } catch (error) {
        if (nodeErrorCode(error) !== "EEXIST") throw error;
        await this.security.rejectReparse?.(path);
        await this.security.verify(path, true);
      }
    }
    return directory;
  }

  async verifyNamespace(subject: ProfileArchiveSubject): Promise<string> {
    const directory = this.directory(subject);
    for (const path of [
      this.base,
      this.originDirectory(subject.appOrigin),
      directory,
    ]) {
      await this.security.rejectReparse?.(path);
      await this.security.verify(path, true);
    }
    return directory;
  }

  async publishArchive(
    reference: ProfileArchiveReference,
    sourcePath: string,
    archive: SafeZipArchive,
  ): Promise<{ readonly directory: string; readonly archiveFile: string }> {
    const directory = await this.ensureNamespace(reference);
    const archiveFile = `${reference.generation}-${reference.sha256}.zip`;
    const destination = join(directory, archiveFile);
    const temporary = join(directory, `.${archiveFile}.${randomUUID()}.tmp`);
    const sourceInfo = await lstat(sourcePath);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink())
      throw new ProfileArchiveStorageError("profile archive source is unsafe");
    try {
      await copyFile(sourcePath, temporary, constants.COPYFILE_EXCL);
      await chmod(temporary, 0o600);
      try {
        await archive.verifyIdentity(temporary, reference);
      } catch (error) {
        throw new ProfileArchiveStorageError(
          "profile archive source identity failed",
          { cause: error },
        );
      }
      const handle = await open(temporary, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      const existing = await lstat(destination).catch((error: unknown) => {
        if (nodeErrorCode(error) === "ENOENT") return undefined;
        throw error;
      });
      if (existing) {
        await this.verifyFile(destination);
        await archive.verifyIdentity(destination, reference);
      } else {
        await rename(temporary, destination);
        await syncDirectory(directory);
      }
      return { directory, archiveFile };
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async verifyFile(path: string): Promise<void> {
    await this.security.rejectReparse?.(path);
    await this.security.verify(path, false);
  }

  async cleanup(directory: string, archiveFile: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === "current.json" || entry.name === archiveFile) continue;
      if (entry.isFile() || entry.isSymbolicLink())
        await rm(join(directory, entry.name), { force: true });
    }
  }

  async remove(subject: ProfileArchiveSubject): Promise<void> {
    const directory = this.directory(subject);
    for (const path of [
      this.base,
      this.originDirectory(subject.appOrigin),
      directory,
    ])
      await this.security.rejectReparse?.(path);
    await rm(directory, { recursive: true, force: true });
  }
}
