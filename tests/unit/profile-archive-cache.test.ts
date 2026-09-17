import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProfileArchiveCache,
  ProfileArchiveStorageError,
  type ProfileArchiveReference,
} from "../../src/core/archive/index.js";
import { statePaths, type PathSecurity } from "../../src/core/config/paths.js";

const roots: string[] = [];
const appOrigin = "https://Profiles.Example.test/";
const profileId = "profile/customer@example.test";

async function fixture(generation = 7) {
  const root = await mkdtemp(join(tmpdir(), "browserlogin-profile-cache-"));
  roots.push(root);
  await mkdir(statePaths(root).cache, { recursive: true, mode: 0o700 });
  const bytes = Buffer.from(
    zipSync({
      Preferences: new TextEncoder().encode(`generation-${generation}`),
    }),
  );
  const sourcePath = join(root, `source-${generation}.zip`);
  await writeFile(sourcePath, bytes, { mode: 0o600 });
  const reference: ProfileArchiveReference = {
    appOrigin,
    profileId,
    generation,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    format: "zip",
  };
  return { root, sourcePath, reference };
}

async function namespace(root: string): Promise<string> {
  const base = join(statePaths(root).cache, "profile-archives");
  const origins = await readdir(base);
  expect(origins).toHaveLength(1);
  const profiles = await readdir(join(base, origins[0] ?? "missing"));
  expect(profiles).toHaveLength(1);
  return join(base, origins[0] ?? "missing", profiles[0] ?? "missing");
}

async function metadataPath(root: string): Promise<string> {
  return join(await namespace(root), "current.json");
}

async function rewriteMetadata(
  root: string,
  mutate: (metadata: Record<string, unknown>) => void,
): Promise<void> {
  const path = await metadataPath(root);
  const metadata = JSON.parse(await readFile(path, "utf8"));
  mutate(metadata);
  await writeFile(path, `${JSON.stringify(metadata)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("ProfileArchiveCache", () => {
  it("publishes, freshly verifies, and privately replaces one committed ZIP", async () => {
    // Given
    const first = await fixture(7);
    const cache = new ProfileArchiveCache(first.root);
    await cache.publish(first.reference, first.sourcePath);

    // When
    const hit = await cache.resolve(first.reference);
    if (hit.kind !== "hit") throw new Error("expected an exact cache hit");
    const hitBytes = await readFile(hit.archivePath);
    const second = await fixture(8);
    const secondSource = join(first.root, "source-8.zip");
    await writeFile(secondSource, await readFile(second.sourcePath), {
      mode: 0o600,
    });
    await cache.publish(second.reference, secondSource);

    // Then
    expect(hit).toMatchObject({
      kind: "hit",
      reference: {
        ...first.reference,
        appOrigin: "https://profiles.example.test",
      },
    });
    expect(hitBytes).toEqual(await readFile(first.sourcePath));
    const directory = await namespace(first.root);
    const entries = await readdir(directory);
    expect(entries.filter((entry) => entry.endsWith(".zip"))).toHaveLength(1);
    expect(entries).toContain("current.json");
    expect(directory).not.toContain("Profiles.Example.test");
    expect(directory).not.toContain(profileId);
    const metadata = JSON.parse(
      await readFile(join(directory, "current.json"), "utf8"),
    );
    expect(metadata).toEqual({
      schema_version: 1,
      app_origin: "https://profiles.example.test",
      profile_id: profileId,
      generation: second.reference.generation,
      size: second.reference.size,
      sha256: second.reference.sha256,
      format: "zip",
      archive_file: `${second.reference.generation}-${second.reference.sha256}.zip`,
    });
  });

  it("returns typed misses for absent namespaces and pointers", async () => {
    // Given
    const input = await fixture();
    const cache = new ProfileArchiveCache(input.root);

    // When
    const absent = await cache.resolve(input.reference);
    await cache.publish(input.reference, input.sourcePath);
    await rm(await metadataPath(input.root));
    const missingPointer = await cache.resolve(input.reference);

    // Then
    expect(absent).toEqual({ kind: "miss", reason: "absent" });
    expect(missingPointer).toEqual({ kind: "miss", reason: "absent" });
  });

  it("returns corruption for malformed metadata", async () => {
    // Given
    const input = await fixture();
    const cache = new ProfileArchiveCache(input.root);
    await cache.publish(input.reference, input.sourcePath);
    await writeFile(await metadataPath(input.root), "{", { mode: 0o600 });

    // When
    const result = await cache.resolve(input.reference);

    // Then
    expect(result).toMatchObject({ kind: "corrupt" });
  });

  it.each([
    [
      "schema version",
      (value: Record<string, unknown>) => (value.schema_version = 2),
    ],
    [
      "origin",
      (value: Record<string, unknown>) =>
        (value.app_origin = "https://other.test"),
    ],
    [
      "profile",
      (value: Record<string, unknown>) => (value.profile_id = "other"),
    ],
    ["generation", (value: Record<string, unknown>) => (value.generation = 99)],
    ["size", (value: Record<string, unknown>) => (value.size = 1)],
    ["format", (value: Record<string, unknown>) => (value.format = "tar")],
    [
      "hash",
      (value: Record<string, unknown>) => (value.sha256 = "a".repeat(64)),
    ],
    [
      "uppercase hash",
      (value: Record<string, unknown>) => (value.sha256 = "A".repeat(64)),
    ],
    [
      "unsafe filename",
      (value: Record<string, unknown>) =>
        (value.archive_file = "../outside.zip"),
    ],
  ])("rejects wrong %s metadata", async (_name, mutate) => {
    // Given
    const input = await fixture();
    const cache = new ProfileArchiveCache(input.root);
    await cache.publish(input.reference, input.sourcePath);
    await rewriteMetadata(input.root, mutate);

    // When
    const result = await cache.resolve(input.reference);

    // Then
    expect(result).toMatchObject({ kind: "corrupt" });
  });

  it("rejects changed ZIP bytes after freshly hashing them", async () => {
    // Given
    const input = await fixture();
    const cache = new ProfileArchiveCache(input.root);
    await cache.publish(input.reference, input.sourcePath);
    const pointer = JSON.parse(
      await readFile(await metadataPath(input.root), "utf8"),
    );
    const archivePath = join(await namespace(input.root), pointer.archive_file);
    await writeFile(archivePath, "changed", { mode: 0o600 });

    // When
    const result = await cache.resolve(input.reference);

    // Then
    expect(result).toMatchObject({ kind: "corrupt" });
  });

  it.each(["pointer", "archive"])(
    "rejects unsafe %s path permissions",
    async (target) => {
      // Given
      const input = await fixture();
      const cache = new ProfileArchiveCache(input.root);
      await cache.publish(input.reference, input.sourcePath);
      const pointerPath = await metadataPath(input.root);
      const metadata = JSON.parse(await readFile(pointerPath, "utf8"));
      const path =
        target === "pointer"
          ? pointerPath
          : join(dirname(pointerPath), metadata.archive_file);
      await chmod(path, 0o644);

      // When
      const result = await cache.resolve(input.reference);

      // Then
      expect(result).toMatchObject({ kind: "corrupt" });
    },
  );

  it("rejects archive directories and symlink pointers without following them", async () => {
    // Given
    const directoryInput = await fixture();
    const directoryCache = new ProfileArchiveCache(directoryInput.root);
    await directoryCache.publish(
      directoryInput.reference,
      directoryInput.sourcePath,
    );
    const pointerPath = await metadataPath(directoryInput.root);
    const metadata = JSON.parse(await readFile(pointerPath, "utf8"));
    const archivePath = join(dirname(pointerPath), metadata.archive_file);
    await rm(archivePath);
    await mkdir(archivePath, { mode: 0o700 });

    const symlinkInput = await fixture();
    const symlinkCache = new ProfileArchiveCache(symlinkInput.root);
    await symlinkCache.publish(symlinkInput.reference, symlinkInput.sourcePath);
    const symlinkPointer = await metadataPath(symlinkInput.root);
    const target = join(symlinkInput.root, "pointer-target.json");
    await writeFile(target, await readFile(symlinkPointer), { mode: 0o600 });
    await rm(symlinkPointer);
    await symlink(target, symlinkPointer);

    // When
    const directoryResult = await directoryCache.resolve(
      directoryInput.reference,
    );
    const symlinkResult = await symlinkCache.resolve(symlinkInput.reference);

    // Then
    expect(directoryResult).toMatchObject({ kind: "corrupt" });
    expect(symlinkResult).toMatchObject({ kind: "corrupt" });
  });

  it("reports path-security I/O failures as typed storage outcomes", async () => {
    // Given
    const input = await fixture();
    const cache = new ProfileArchiveCache(input.root);
    await cache.publish(input.reference, input.sourcePath);
    const storageFailure = Object.assign(new Error("storage unavailable"), {
      code: "EIO",
    });
    const security: PathSecurity = {
      secure: () => undefined,
      verify: () => {
        throw storageFailure;
      },
    };
    const ownership: PathSecurity = {
      secure: () => undefined,
      verify: () => {
        throw new Error("private path is not owned by the current user");
      },
    };

    // When
    const unsafeOwner = await new ProfileArchiveCache(input.root, {
      security: ownership,
    }).resolve(input.reference);
    const result = await new ProfileArchiveCache(input.root, {
      security,
    }).resolve(input.reference);

    // Then
    expect(unsafeOwner).toMatchObject({ kind: "corrupt" });
    expect(result).toMatchObject({ kind: "storage_error" });
    if (result.kind !== "storage_error")
      throw new Error("expected storage outcome");
    expect(result.error).toBeInstanceOf(ProfileArchiveStorageError);
  });

  it("removes only its hashed namespace and is idempotent", async () => {
    // Given
    const input = await fixture();
    const cache = new ProfileArchiveCache(input.root);
    await cache.publish(input.reference, input.sourcePath);
    const cacheNamespace = await namespace(input.root);
    const unrelated = join(statePaths(input.root).cache, "unrelated");
    await writeFile(unrelated, "keep");

    // When
    await cache.remove(input.reference);
    await cache.remove(input.reference);

    // Then
    await expect(readFile(unrelated, "utf8")).resolves.toBe("keep");
    await expect(lstat(cacheNamespace)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("preserves the previous pair when interrupted before pointer commit", async () => {
    // Given
    const first = await fixture(1);
    const cache = new ProfileArchiveCache(first.root);
    await cache.publish(first.reference, first.sourcePath);
    const second = await fixture(2);
    const secondSource = join(first.root, "source-2.zip");
    await writeFile(secondSource, await readFile(second.sourcePath), {
      mode: 0o600,
    });
    const interrupted = new ProfileArchiveCache(first.root, {
      faultInjector: (point) => {
        if (point === "before-pointer-commit")
          throw new Error("simulated crash");
      },
    });

    // When
    await expect(
      interrupted.publish(second.reference, secondSource),
    ).rejects.toThrow("simulated crash");
    await expect(
      interrupted.publish(second.reference, secondSource),
    ).rejects.toThrow("simulated crash");
    const resolved = await cache.resolve(first.reference);

    // Then
    expect(resolved).toMatchObject({
      kind: "hit",
      reference: {
        ...first.reference,
        appOrigin: "https://profiles.example.test",
      },
    });
    expect(
      (await readdir(await namespace(first.root))).filter((name) =>
        name.endsWith(".zip"),
      ),
    ).toHaveLength(1);
  });

  it("selects the committed pointer after interrupted cleanup and recovers one ZIP", async () => {
    // Given
    const first = await fixture(1);
    const cache = new ProfileArchiveCache(first.root);
    await cache.publish(first.reference, first.sourcePath);
    const second = await fixture(2);
    const secondSource = join(first.root, "source-2.zip");
    await writeFile(secondSource, await readFile(second.sourcePath), {
      mode: 0o600,
    });
    const interrupted = new ProfileArchiveCache(first.root, {
      faultInjector: (point) => {
        if (point === "before-cleanup") throw new Error("simulated crash");
      },
    });

    // When
    await expect(
      interrupted.publish(second.reference, secondSource),
    ).rejects.toThrow("simulated crash");
    const resolved = await cache.resolve(second.reference);

    // Then
    expect(resolved).toMatchObject({
      kind: "hit",
      reference: {
        ...second.reference,
        appOrigin: "https://profiles.example.test",
      },
    });
    const archives = (await readdir(await namespace(first.root))).filter(
      (name) => name.endsWith(".zip"),
    );
    expect(archives).toEqual([
      basename(resolved.kind === "hit" ? resolved.archivePath : ""),
    ]);
  });
});
