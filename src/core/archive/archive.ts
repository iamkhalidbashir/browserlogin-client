import { createHash } from "node:crypto";
import { closeSync, createReadStream, openSync, writeSync } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { Zip, ZipDeflate, Unzip, UnzipInflate, UnzipPassThrough } from "fflate";
import { ArchiveError } from "../../shared/errors.js";

const DISPOSABLE_CACHE_DIRS = [
  "Default/Cache",
  "Default/Code Cache",
  "Default/GPUCache",
  "Default/DawnCache",
  "Default/DawnGraphiteCache",
  "Default/DawnWebGPUCache",
  "ShaderCache",
  "GrShaderCache",
  "GraphiteDawnCache",
  "DawnCache",
].map((value) => value.split("/"));
const DISPOSABLE_RUNTIME_FILES = new Set([
  "RunningChromeVersion",
  "SingletonCookie",
  "SingletonLock",
  "SingletonSocket",
  "BrowserMetrics-spare.pma",
]);
const WINDOWS_RESERVED = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
]);
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
// fflate's streaming ZIP parser avoids deep recursion when input chunks stay bounded.
const CHUNK_SIZE = 64 * 1024;

export interface ArchiveLimits {
  maxArchiveBytes: number;
  maxFiles: number;
  maxTotalSize: number;
  maxFileSize: number;
  maxCompressionRatio: number;
}

export const ARCHIVE_LIMITS: Readonly<ArchiveLimits> = Object.freeze({
  maxArchiveBytes: 512 * 1024 * 1024,
  maxFiles: 100_000,
  maxTotalSize: 2 * 1024 * 1024 * 1024,
  maxFileSize: 512 * 1024 * 1024,
  maxCompressionRatio: 200,
});

export type ArchiveCode =
  | "UNSAFE_PATH"
  | "ABSOLUTE_PATH"
  | "DRIVE_PATH"
  | "INVALID_NAME"
  | "RESERVED_NAME"
  | "CASE_COLLISION"
  | "SYMLINK"
  | "SPECIAL_ENTRY"
  | "CONFLICTING_PATH"
  | "FILE_COUNT"
  | "FILE_SIZE"
  | "TOTAL_SIZE"
  | "ARCHIVE_SIZE"
  | "COMPRESSION_RATIO"
  | "MALFORMED_ZIP"
  | "UNSUPPORTED_COMPRESSION"
  | "TRUNCATED_ENTRY"
  | "IDENTITY_MISMATCH"
  | "CLEANUP_FAILED";

export interface ArchiveIdentity {
  size: number;
  sha256: string;
  format: "zip";
}

export interface ArchiveMetadata {
  fileCount: number;
  totalSize: number;
  archiveSize?: number;
  largestFileSize?: number;
  totalCompressedSize?: number;
}

export interface ArchiveEntryMetadata {
  name: string;
  key: string;
  directory: boolean;
  fileSize: number;
  compressedSize: number;
  compression: number;
  externalAttributes: number;
}

type ArchiveFailure = ArchiveError & {
  archive_code: ArchiveCode;
  details?: Record<string, unknown>;
};

function failure(
  code: ArchiveCode,
  message: string,
  details?: Record<string, unknown>,
): ArchiveFailure {
  const error = new ArchiveError(message) as ArchiveFailure;
  error.archive_code = code;
  error.details = details;
  return error;
}

export function archiveCode(error: unknown): ArchiveCode | undefined {
  return error instanceof ArchiveError
    ? (error as Partial<ArchiveFailure>).archive_code
    : undefined;
}

export function validateArchiveLimits(
  limits: ArchiveLimits,
  metadata: ArchiveMetadata,
): void {
  if (
    metadata.archiveSize !== undefined &&
    metadata.archiveSize > limits.maxArchiveBytes
  ) {
    throw failure("ARCHIVE_SIZE", "archive exceeds configured maximum size");
  }
  if (metadata.fileCount > limits.maxFiles) {
    throw failure("FILE_COUNT", "archive contains excessive file count");
  }
  if (
    metadata.largestFileSize !== undefined &&
    metadata.largestFileSize > limits.maxFileSize
  ) {
    throw failure("FILE_SIZE", "archive entry exceeds configured maximum size");
  }
  if (metadata.totalSize > limits.maxTotalSize) {
    throw failure("TOTAL_SIZE", "archive expands beyond configured limit");
  }
  if (
    metadata.totalCompressedSize &&
    metadata.totalSize / metadata.totalCompressedSize >
      limits.maxCompressionRatio
  ) {
    throw failure(
      "COMPRESSION_RATIO",
      "archive compression ratio exceeds limit",
    );
  }
}

function normalizeName(rawName: string): { name: string; key: string } {
  if (!rawName) throw failure("UNSAFE_PATH", "unsafe ZIP path");
  if (rawName.includes("\0"))
    throw failure("INVALID_NAME", "ZIP path contains NUL");
  if ([...rawName].some((character) => character.codePointAt(0)! < 32)) {
    throw failure("INVALID_NAME", "ZIP path contains a control character");
  }
  if (/^(?:\\\\|\/\\)/.test(rawName))
    throw failure("DRIVE_PATH", "ZIP path contains a drive or UNC prefix");
  const raw = rawName.replaceAll("\\", "/");
  if (raw.startsWith("/"))
    throw failure("ABSOLUTE_PATH", "ZIP path is absolute");
  if (/^(?:[A-Za-z]:|\\\\)/.test(raw))
    throw failure("DRIVE_PATH", "ZIP path contains a drive or UNC prefix");
  const parts = raw.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "..")) {
    throw failure("UNSAFE_PATH", "ZIP path contains a parent traversal");
  }
  for (const part of parts) {
    if (part.endsWith(" ") || part.endsWith(".") || part.includes(":")) {
      throw failure(
        "INVALID_NAME",
        "ZIP path contains an invalid Win32 component",
      );
    }
    if (/[<>"|?*]/.test(part))
      throw failure(
        "INVALID_NAME",
        "ZIP path contains an invalid Win32 component",
      );
    if (WINDOWS_RESERVED.has(part.split(".", 1)[0].toUpperCase())) {
      throw failure(
        "RESERVED_NAME",
        "ZIP path contains a reserved Win32 device name",
      );
    }
  }
  const name = parts.join("/");
  return { name, key: name.toLocaleLowerCase("en-US") };
}

function disposable(name: string): boolean {
  const parts = name.split("/");
  if (DISPOSABLE_RUNTIME_FILES.has(name)) return true;
  return DISPOSABLE_CACHE_DIRS.some(
    (prefix) =>
      prefix.length <= parts.length &&
      prefix.every(
        (part, index) =>
          part.toLocaleLowerCase("en-US") ===
          parts[index].toLocaleLowerCase("en-US"),
      ),
  );
}

function isDirectoryEntry(name: string, externalAttributes: number): boolean {
  return (
    name.endsWith("/") || ((externalAttributes >>> 16) & 0xf000) === 0x4000
  );
}

function isSymlink(externalAttributes: number): boolean {
  return ((externalAttributes >>> 16) & 0xf000) === 0xa000;
}

function readU16(buffer: Uint8Array, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8);
}

function readU32(buffer: Uint8Array, offset: number): number {
  return (
    (buffer[offset] |
      (buffer[offset + 1] << 8) |
      (buffer[offset + 2] << 16) |
      (buffer[offset + 3] << 24)) >>>
    0
  );
}

function writeAll(fd: number, chunk: Uint8Array): void {
  let offset = 0;
  while (offset < chunk.length)
    offset += writeSync(fd, chunk, offset, chunk.length - offset);
}

async function readRange(
  path: string,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const result = await handle.read(buffer, 0, length, offset);
    if (result.bytesRead !== length)
      throw failure("MALFORMED_ZIP", "truncated ZIP metadata");
    return buffer;
  } finally {
    await handle.close();
  }
}

async function readCentralDirectory(
  path: string,
  archiveSize: number,
  limits: ArchiveLimits,
): Promise<ArchiveEntryMetadata[]> {
  const tailLength = Math.min(archiveSize, 22 + 65_535);
  const tail = await readRange(path, archiveSize - tailLength, tailLength);
  let eocd = -1;
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (readU32(tail, index) === EOCD_SIGNATURE) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw failure("MALFORMED_ZIP", "invalid ZIP archive");
  const entryCount = readU16(tail, eocd + 10);
  const centralSize = readU32(tail, eocd + 12);
  const centralOffset = readU32(tail, eocd + 16);
  if (
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw failure("MALFORMED_ZIP", "ZIP64 archives are not supported");
  }
  validateArchiveLimits(limits, { fileCount: entryCount, totalSize: 0 });
  if (
    centralOffset + centralSize > archiveSize ||
    centralSize > limits.maxArchiveBytes
  ) {
    throw failure(
      "MALFORMED_ZIP",
      "ZIP central directory is outside the archive",
    );
  }
  const central = await readRange(path, centralOffset, centralSize);
  const entries: ArchiveEntryMetadata[] = [];
  const seen = new Set<string>();
  const kinds = new Map<string, "file" | "directory">();
  let offset = 0;
  let totalSize = 0;
  let totalCompressedSize = 0;
  let largestFileSize = 0;
  while (offset < central.length) {
    if (
      offset + 46 > central.length ||
      readU32(central, offset) !== CENTRAL_SIGNATURE
    ) {
      throw failure("MALFORMED_ZIP", "invalid ZIP central directory entry");
    }
    const flags = readU16(central, offset + 8);
    const compression = readU16(central, offset + 10);
    const compressedSize = readU32(central, offset + 20);
    const fileSize = readU32(central, offset + 24);
    const nameLength = readU16(central, offset + 28);
    const extraLength = readU16(central, offset + 30);
    const commentLength = readU16(central, offset + 32);
    const externalAttributes = readU32(central, offset + 38);
    const localOffset = readU32(central, offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (
      end > central.length ||
      localOffset >= archiveSize ||
      (flags & 1) !== 0
    ) {
      throw failure("MALFORMED_ZIP", "invalid ZIP entry metadata");
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let rawName: string;
    try {
      rawName = decoder.decode(
        central.subarray(offset + 46, offset + 46 + nameLength),
      );
    } catch (error) {
      throw failure("MALFORMED_ZIP", "ZIP filename is not valid UTF-8", {
        cause: error,
      });
    }
    const directory = isDirectoryEntry(rawName, externalAttributes);
    if (isSymlink(externalAttributes))
      throw failure("SYMLINK", "ZIP symlink rejected");
    if (compression !== 0 && compression !== 8)
      throw failure(
        "UNSUPPORTED_COMPRESSION",
        "unsupported ZIP compression method",
      );
    const { name, key } = normalizeName(rawName);
    if (seen.has(key))
      throw failure("CASE_COLLISION", "duplicate or case-colliding ZIP path");
    seen.add(key);
    const kind = directory ? "directory" : "file";
    kinds.set(key, kind);
    const parts = name.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const parentKey = parts
        .slice(0, index)
        .join("/")
        .toLocaleLowerCase("en-US");
      if (kinds.get(parentKey) === "file")
        throw failure("CONFLICTING_PATH", "conflicting ZIP paths");
    }
    if (
      !directory &&
      [...kinds].some(
        ([otherKey, otherKind]) =>
          otherKind === "file" && otherKey.startsWith(`${key}/`),
      )
    ) {
      throw failure("CONFLICTING_PATH", "conflicting ZIP paths");
    }
    if (!disposable(name) && !directory) {
      totalSize += fileSize;
      totalCompressedSize += compressedSize;
      largestFileSize = Math.max(largestFileSize, fileSize);
    }
    entries.push({
      name,
      key,
      directory,
      fileSize,
      compressedSize,
      compression,
      externalAttributes,
    });
    offset = end;
  }
  validateArchiveLimits(limits, {
    fileCount: entryCount,
    totalSize,
    largestFileSize,
    totalCompressedSize,
    archiveSize,
  });
  return entries;
}

async function sha256File(path: string): Promise<ArchiveIdentity> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path, {
    highWaterMark: CHUNK_SIZE,
  })) {
    size += chunk.length;
    hash.update(chunk);
  }
  return { size, sha256: hash.digest("hex"), format: "zip" };
}

export async function verifyArchiveIdentity(
  path: string,
  expected: ArchiveIdentity,
): Promise<ArchiveIdentity> {
  const actual = await sha256File(resolve(path));
  if (
    actual.size !== expected.size ||
    actual.sha256 !== expected.sha256 ||
    expected.format !== "zip"
  ) {
    throw failure(
      "IDENTITY_MISMATCH",
      "archive length or SHA-256 verification failed",
    );
  }
  return actual;
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
}

async function removeTree(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

async function sourceFiles(source: string, root: string): Promise<string[]> {
  const output: string[] = [];
  const entries = (await readdir(source, { withFileTypes: true })).sort(
    (left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  for (const entry of entries) {
    const path = join(source, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink())
      throw failure(
        "SYMLINK",
        "refusing to archive a symlink, junction, or reparse point",
      );
    const name = relative(root, path).split("\\").join("/");
    normalizeName(name);
    if (info.isDirectory()) output.push(...(await sourceFiles(path, root)));
    else if (info.isFile()) {
      if (!disposable(name)) output.push(path);
    } else
      throw failure(
        "SPECIAL_ENTRY",
        "refusing to archive a special filesystem entry",
      );
  }
  return output;
}

async function streamZipFile(
  zipper: Zip,
  path: string,
  filename: string,
): Promise<void> {
  const file = new ZipDeflate(filename, { level: 6, mem: 8 });
  file.mtime = new Date("1980-01-01T00:00:00.000Z");
  zipper.add(file);
  const input = createReadStream(path, { highWaterMark: CHUNK_SIZE });
  for await (const chunk of input) file.push(chunk, false);
  file.push(new Uint8Array(), true);
}

async function discardCaches(source: string, root: string): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const path = join(source, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink())
      throw failure(
        "SYMLINK",
        "refusing to remove a symlink, junction, or reparse point",
      );
    const name = relative(root, path).split("\\").join("/");
    normalizeName(name);
    if (info.isDirectory() && disposable(name)) {
      await removeTree(path);
    } else if (info.isDirectory()) {
      await discardCaches(path, root);
    }
  }
}

export class SafeZipArchive {
  readonly limits: ArchiveLimits;

  constructor(limits: Partial<ArchiveLimits> = {}) {
    this.limits = Object.freeze({ ...ARCHIVE_LIMITS, ...limits });
  }

  async discardLegacyDisposableCaches(source: string): Promise<void> {
    const info = await lstat(source).catch(() => undefined);
    if (!info?.isDirectory() || info.isSymbolicLink())
      throw failure(
        "SPECIAL_ENTRY",
        "profile work must be a regular directory",
      );
    await discardCaches(source, source);
  }

  async create(source: string, destination: string): Promise<ArchiveIdentity> {
    const sourceInfo = await lstat(source).catch(() => undefined);
    if (!sourceInfo?.isDirectory() || sourceInfo.isSymbolicLink())
      throw failure(
        "SPECIAL_ENTRY",
        "archive source must be a regular directory",
      );
    const files = await sourceFiles(source, source);
    const seen = new Set<string>();
    let totalSize = 0;
    if (files.length > this.limits.maxFiles)
      throw failure("FILE_COUNT", "archive contains excessive file count");
    for (const path of files) {
      const name = relative(source, path).split("\\").join("/");
      const key = normalizeName(name).key;
      if (seen.has(key))
        throw failure(
          "CASE_COLLISION",
          "archive source contains colliding paths",
        );
      seen.add(key);
      const size = (await lstat(path)).size;
      if (size > this.limits.maxFileSize)
        throw failure(
          "FILE_SIZE",
          "archive entry exceeds configured maximum size",
        );
      totalSize += size;
      if (totalSize > this.limits.maxTotalSize)
        throw failure(
          "TOTAL_SIZE",
          "archive source exceeds configured total size",
        );
    }
    await ensurePrivateDirectory(dirname(destination));
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    let outputBytes = 0;
    try {
      const outputFd = openSync(temporary, "wx", 0o600);
      try {
        const zipper = new Zip((error, chunk) => {
          if (error)
            throw failure("MALFORMED_ZIP", "ZIP creation failed", {
              cause: error,
            });
          outputBytes += chunk.length;
          if (outputBytes > this.limits.maxArchiveBytes)
            throw failure(
              "ARCHIVE_SIZE",
              "archive exceeds configured maximum size",
            );
          writeAll(outputFd, chunk);
        });
        for (const path of files)
          await streamZipFile(
            zipper,
            path,
            relative(source, path).split("\\").join("/"),
          );
        zipper.end();
      } finally {
        closeSync(outputFd);
      }
      const identity = await sha256File(temporary);
      validateArchiveLimits(this.limits, {
        fileCount: files.length,
        totalSize,
        archiveSize: identity.size,
      });
      await rename(temporary, destination);
      return identity;
    } catch (error) {
      await removeTree(temporary);
      throw error;
    }
  }

  async extractAtomic(
    archive: string,
    destination: string,
    expected?: ArchiveIdentity,
  ): Promise<void> {
    const archiveInfo = await lstat(archive).catch(() => undefined);
    if (!archiveInfo?.isFile() || archiveInfo.isSymbolicLink())
      throw failure("SPECIAL_ENTRY", "archive must be a regular file");
    validateArchiveLimits(this.limits, {
      fileCount: 0,
      totalSize: 0,
      archiveSize: archiveInfo.size,
    });
    if (expected) {
      await verifyArchiveIdentity(archive, expected);
    }
    await ensurePrivateDirectory(dirname(destination));
    const destinationInfo = await lstat(destination).catch(() => undefined);
    if (destinationInfo?.isSymbolicLink())
      throw failure("SYMLINK", "archive destination cannot be a symlink");
    const staging = `${destination}.${process.pid}.${Date.now()}.staging`;
    const backup = `${destination}.previous`;
    await ensurePrivateDirectory(staging);
    try {
      const entries = await readCentralDirectory(
        archive,
        archiveInfo.size,
        this.limits,
      );
      const byKey = new Map(entries.map((entry) => [entry.key, entry]));
      for (const entry of entries.filter(
        (item) => !item.directory && !disposable(item.name),
      )) {
        await ensurePrivateDirectory(
          dirname(join(staging, ...entry.name.split("/"))),
        );
      }
      const unzipper = new Unzip();
      unzipper.register(UnzipInflate);
      unzipper.register(UnzipPassThrough);
      let current:
        { fd: number; entry: ArchiveEntryMetadata; bytes: number } | undefined;
      let seenFiles = 0;
      let extractionError: unknown;
      unzipper.onfile = (file) => {
        try {
          const { name, key } = normalizeName(file.name);
          const entry = byKey.get(key);
          if (!entry || entry.name !== name)
            throw failure(
              "MALFORMED_ZIP",
              "ZIP local header does not match central directory",
            );
          if (entry.directory || disposable(name)) return;
          if (
            (file.originalSize !== undefined &&
              file.originalSize !== entry.fileSize) ||
            (file.size !== undefined && file.size !== entry.compressedSize)
          )
            throw failure("MALFORMED_ZIP", "ZIP entry size metadata mismatch");
          const target = join(staging, ...name.split("/"));
          current = { fd: openSync(target, "wx", 0o600), entry, bytes: 0 };
          file.ondata = (error, chunk, final) => {
            try {
              if (error)
                throw failure(
                  "MALFORMED_ZIP",
                  "ZIP entry decompression failed",
                  { cause: error },
                );
              if (!current)
                throw failure(
                  "TRUNCATED_ENTRY",
                  "ZIP entry has no output stream",
                );
              current.bytes += chunk.length;
              if (
                current.bytes > this.limits.maxFileSize ||
                current.bytes > current.entry.fileSize
              )
                throw failure(
                  "FILE_SIZE",
                  "ZIP entry exceeded configured maximum size",
                );
              writeAll(current.fd, chunk);
              if (final) {
                if (current.bytes !== current.entry.fileSize)
                  throw failure("TRUNCATED_ENTRY", "truncated ZIP entry");
                closeSync(current.fd);
                seenFiles += 1;
                current = undefined;
              }
            } catch (error) {
              if (current) {
                closeSync(current.fd);
                current = undefined;
              }
              throw error;
            }
          };
          file.start();
        } catch (error) {
          extractionError = error;
          throw error;
        }
      };
      for await (const chunk of createReadStream(archive, {
        highWaterMark: CHUNK_SIZE,
      }))
        unzipper.push(chunk);
      unzipper.push(new Uint8Array(), true);
      if (extractionError) throw extractionError;
      if (
        seenFiles !==
        entries.filter((entry) => !entry.directory && !disposable(entry.name))
          .length
      )
        throw failure(
          "MALFORMED_ZIP",
          "ZIP file set does not match central directory",
        );
      await removeTree(backup);
      if (destinationInfo) await rename(destination, backup);
      await rename(staging, destination);
      await removeTree(backup);
    } catch (error) {
      try {
        await removeTree(staging);
        const backupInfo = await lstat(backup).catch(() => undefined);
        const destinationNow = await lstat(destination).catch(() => undefined);
        if (backupInfo && !destinationNow) await rename(backup, destination);
      } catch (cleanupError) {
        throw failure("CLEANUP_FAILED", "archive activation cleanup failed", {
          cause: cleanupError,
          original: error,
        });
      }
      throw error;
    }
  }

  async identity(path: string): Promise<ArchiveIdentity> {
    return sha256File(resolve(path));
  }

  async verifyIdentity(
    path: string,
    expected: ArchiveIdentity,
  ): Promise<ArchiveIdentity> {
    return verifyArchiveIdentity(path, expected);
  }
}
