import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARCHIVE_LIMITS,
  SafeZipArchive,
  archiveCode,
  validateArchiveLimits,
} from "../../src/core/archive/index.js";
import type { ArchiveMetadata } from "../../src/core/archive/index.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "browserlogin-archive-test-"));
  roots.push(root);
  return root;
}

async function filesUnder(
  root: string,
  prefix = "",
): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  for (const name of await readdir(join(root, prefix))) {
    const relative = prefix ? `${prefix}/${name}` : name;
    const path = join(root, relative);
    try {
      result.set(relative, await readFile(path));
    } catch {
      for (const [child, bytes] of await filesUnder(root, relative))
        result.set(child, bytes);
    }
  }
  return result;
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("expected action to fail");
  } catch (error) {
    expect(archiveCode(error)).toBe(code);
  }
}

async function expectArchiveCode(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await action();
    throw new Error("expected action to fail");
  } catch (error) {
    expect(archiveCode(error)).toBe(code);
  }
}

function symlinkArchive(): Uint8Array {
  const bytes = zipSync({ "link.txt": new Uint8Array([1]) });
  for (let index = 0; index + 46 <= bytes.length; index += 1) {
    if (
      bytes[index] === 0x50 &&
      bytes[index + 1] === 0x4b &&
      bytes[index + 2] === 0x01 &&
      bytes[index + 3] === 0x02
    ) {
      bytes[index + 38] = 0;
      bytes[index + 39] = 0;
      bytes[index + 40] = 0;
      bytes[index + 41] = 0xa0;
      break;
    }
  }
  return bytes;
}

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
}, 120_000);

describe("SafeZipArchive", () => {
  it("exposes the exact Python limits and checks limit minus/at/plus boundaries", () => {
    expect(ARCHIVE_LIMITS).toEqual({
      maxArchiveBytes: 512 * 1024 * 1024,
      maxFiles: 100_000,
      maxTotalSize: 2 * 1024 * 1024 * 1024,
      maxFileSize: 512 * 1024 * 1024,
      maxCompressionRatio: 200,
    });
    for (const [field, limit] of Object.entries(ARCHIVE_LIMITS)) {
      const metadata: ArchiveMetadata = { fileCount: 0, totalSize: 0 };
      const key =
        field === "maxArchiveBytes"
          ? "archiveSize"
          : field === "maxFiles"
            ? "fileCount"
            : field === "maxTotalSize"
              ? "totalSize"
              : field === "maxFileSize"
                ? "largestFileSize"
                : "totalCompressedSize";
      if (field === "maxCompressionRatio") {
        validateArchiveLimits(ARCHIVE_LIMITS, {
          fileCount: 0,
          totalSize: 199,
          totalCompressedSize: 1,
        });
        expectCode(
          () =>
            validateArchiveLimits(ARCHIVE_LIMITS, {
              fileCount: 0,
              totalSize: 201,
              totalCompressedSize: 1,
            }),
          "COMPRESSION_RATIO",
        );
        continue;
      }
      (metadata as unknown as Record<string, number>)[key] = limit - 1;
      validateArchiveLimits(ARCHIVE_LIMITS, metadata);
      (metadata as unknown as Record<string, number>)[key] = limit;
      validateArchiveLimits(ARCHIVE_LIMITS, metadata);
      (metadata as unknown as Record<string, number>)[key] = limit + 1;
      expectCode(
        () => validateArchiveLimits(ARCHIVE_LIMITS, metadata),
        field === "maxArchiveBytes"
          ? "ARCHIVE_SIZE"
          : field === "maxFiles"
            ? "FILE_COUNT"
            : field === "maxTotalSize"
              ? "TOTAL_SIZE"
              : "FILE_SIZE",
      );
    }
  });

  it("adversarial: rejects twelve malicious path, metadata, compression, and malformed cases", async () => {
    const root = await temporaryRoot();
    const archive = new SafeZipArchive();
    const cases: Array<[string, Uint8Array, string]> = [
      [
        "parent traversal",
        zipSync({ "../escape": new Uint8Array([1]) }),
        "UNSAFE_PATH",
      ],
      [
        "absolute path",
        zipSync({ "/escape": new Uint8Array([1]) }),
        "ABSOLUTE_PATH",
      ],
      [
        "drive path",
        zipSync({ "C:/escape": new Uint8Array([1]) }),
        "DRIVE_PATH",
      ],
      [
        "UNC path",
        zipSync({ "\\\\server\\escape": new Uint8Array([1]) }),
        "DRIVE_PATH",
      ],
      [
        "NUL name",
        zipSync({ "bad\0name": new Uint8Array([1]) }),
        "INVALID_NAME",
      ],
      [
        "control name",
        zipSync({ "bad\u0001name": new Uint8Array([1]) }),
        "INVALID_NAME",
      ],
      [
        "reserved name",
        zipSync({ "CON.txt": new Uint8Array([1]) }),
        "RESERVED_NAME",
      ],
      [
        "case collision",
        zipSync({ Readme: new Uint8Array([1]), README: new Uint8Array([2]) }),
        "CASE_COLLISION",
      ],
      ["symlink", symlinkArchive(), "SYMLINK"],
      [
        "unsupported compression",
        new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
        "MALFORMED_ZIP",
      ],
      [
        "compression ratio",
        zipSync({ "bomb.txt": new Uint8Array(1024 * 1024) }),
        "COMPRESSION_RATIO",
      ],
      ["malformed bytes", new Uint8Array([0x50, 0x4b, 0x03]), "MALFORMED_ZIP"],
    ];
    for (const [name, bytes, expected] of cases) {
      const path = join(root, `${name.replaceAll(" ", "-")}.zip`);
      await writeFile(path, bytes);
      const destination = join(root, name.replaceAll(" ", "-") + "-out");
      const configured =
        name === "compression ratio"
          ? new SafeZipArchive({ maxCompressionRatio: 2 })
          : archive;
      await expectArchiveCode(
        () => configured.extractAtomic(path, destination),
        expected,
      );
      await expect(
        readdir(root, { withFileTypes: true }),
      ).resolves.not.toContainEqual(
        expect.objectContaining({ name: `${name.replaceAll(" ", "-")}-out` }),
      );
    }
  });

  it("creates deterministic ZIPs, excludes disposable runtime entries, and verifies identity", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source");
    await mkdir(join(source, "Default", "Cache"), { recursive: true });
    await mkdir(join(source, "Default"), { recursive: true });
    await writeFile(join(source, "profile.json"), "DATA");
    await writeFile(join(source, "Default", "Cache", "discard.me"), "cache");
    await writeFile(join(source, "SingletonLock"), "runtime");
    const first = join(root, "one.zip");
    const second = join(root, "two.zip");
    const archive = new SafeZipArchive();
    const identity = await archive.create(source, first);
    const secondIdentity = await archive.create(source, second);
    expect(secondIdentity).toEqual(identity);
    expect(await archive.verifyIdentity(first, identity)).toEqual(identity);
    expect(await readFile(first)).toEqual(await readFile(second));
    await expectArchiveCode(
      () =>
        archive.extractAtomic(first, join(root, "restored"), {
          ...identity,
          sha256: identity.sha256.replace(/^./, "0"),
        }),
      "IDENTITY_MISMATCH",
    );
    await archive.extractAtomic(first, join(root, "restored"), identity);
    expect(await filesUnder(join(root, "restored"))).toEqual(
      new Map([["profile.json", Buffer.from("DATA")]]),
    );
  });

  it("round trips a synthetic 10k-file profile tree and removes staging on failure", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    for (let index = 0; index < 10_000; index += 1) {
      const directory = join(
        source,
        `d${String(index % 100).padStart(3, "0")}`,
      );
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, `f${String(index).padStart(5, "0")}.bin`),
        Buffer.from(`profile-${index}`),
      );
    }
    const archive = new SafeZipArchive();
    const zipPath = join(root, "profile.zip");
    const identity = await archive.create(source, zipPath);
    const destination = join(root, "restored");
    await archive.extractAtomic(zipPath, destination, identity);
    expect(await filesUnder(source)).toEqual(await filesUnder(destination));
    await writeFile(zipPath, Buffer.from("not a zip"));
    await expect(
      archive.extractAtomic(zipPath, join(root, "failed")),
    ).rejects.toThrow();
    expect(
      (await readdir(root)).filter((name) => name.includes("staging")),
    ).toEqual([]);
  }, 120_000);
});
