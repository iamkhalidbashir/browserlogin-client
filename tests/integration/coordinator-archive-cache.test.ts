import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProfileArchiveCorruptionError,
  ProfileArchiveStorageError,
  type ProfileArchiveResolveResult,
} from "../../src/core/archive/index.js";
import {
  cleanupCoordinatorCacheFixtures,
  identity,
  ORIGIN,
  PROFILE_ID,
  setupCoordinatorCache as setup,
} from "../fixtures/coordinator-cache.js";

afterEach(cleanupCoordinatorCacheFixtures);

describe("coordinator archive cache", () => {
  it("uses an exact verified hit without downloading", async () => {
    // Given
    const fixture = await setup({
      cacheResult: {
        kind: "hit",
        archivePath: "/cache/cached.zip",
        reference: { ...identity, appOrigin: ORIGIN, profileId: PROFILE_ID },
      },
    });
    // When
    await fixture.coordinator.start(PROFILE_ID);
    // Then
    expect(fixture.downloads).toHaveLength(0);
    expect(fixture.archive.extracted).toEqual(["/cache/cached.zip"]);
    expect(fixture.progress).toEqual([]);
  });

  it("invalidates an authoritative null archive without downloading", async () => {
    // Given
    const fixture = await setup({ remoteArchive: null });
    // When
    await fixture.coordinator.start(PROFILE_ID);
    // Then
    expect(fixture.removed).toEqual([
      { appOrigin: ORIGIN, profileId: PROFILE_ID },
    ]);
    expect(fixture.downloads).toHaveLength(0);
  });

  it.each(["miss", "corrupt", "storage_error"] as const)(
    "downloads once and refreshes after a cache %s",
    async (kind) => {
      // Given
      const error = new ProfileArchiveStorageError("cache unavailable");
      const cacheResult: ProfileArchiveResolveResult =
        kind === "miss"
          ? { kind: "miss", reason: "absent" }
          : kind === "corrupt"
            ? {
                kind: "corrupt",
                error: new ProfileArchiveCorruptionError("corrupt"),
              }
            : { kind: "storage_error", error };
      const fixture = await setup({ cacheResult });
      // When
      await fixture.coordinator.start(PROFILE_ID);
      // Then
      expect(fixture.downloads).toHaveLength(1);
      expect(fixture.published).toHaveLength(1);
    },
  );

  it("invalidates an extraction-failing hit and makes one bounded download", async () => {
    // Given
    const fixture = await setup({
      cacheResult: {
        kind: "hit",
        archivePath: "/cache/cached.zip",
        reference: { ...identity, appOrigin: ORIGIN, profileId: PROFILE_ID },
      },
    });
    fixture.archive.failCachedExtraction = true;
    // When
    await fixture.coordinator.start(PROFILE_ID);
    // Then
    expect(fixture.removed).toHaveLength(1);
    expect(fixture.downloads).toHaveLength(1);
  });

  it("does not retry a malformed downloaded archive", async () => {
    // Given
    const fixture = await setup();
    fixture.archive.failDownloadedExtraction = true;
    // When / Then
    await expect(fixture.coordinator.start(PROFILE_ID)).rejects.toThrow(
      "malformed ZIP",
    );
    expect(fixture.downloads).toHaveLength(1);
    expect(fixture.published).toHaveLength(0);
  });

  it("preserves stale cache on download failure and ignores typed refresh failure", async () => {
    // Given
    const failed = await setup({
      cacheResult: {
        kind: "corrupt",
        error: new ProfileArchiveCorruptionError("stale identity"),
      },
      downloadFailure: new Error("network failed"),
    });
    const refreshed = await setup({
      publishFailure: new ProfileArchiveStorageError("disk full"),
    });
    // When / Then
    await expect(failed.coordinator.start(PROFILE_ID)).rejects.toThrow(
      "network failed",
    );
    expect(failed.removed).toHaveLength(0);
    await expect(
      refreshed.coordinator.start(PROFILE_ID),
    ).resolves.toMatchObject({ status: "running" });
  });

  it("keeps stop recovery state when strict committed publication fails", async () => {
    // Given
    const fixture = await setup({
      remoteArchive: null,
      publishFailure: new ProfileArchiveStorageError("disk full"),
    });
    await fixture.coordinator.start(PROFILE_ID);
    // When / Then
    await expect(fixture.coordinator.stop(PROFILE_ID)).rejects.toThrow(
      "disk full",
    );
    const state = await fixture.coordinator.store.load(PROFILE_ID);
    expect(state).toMatchObject({ status: "upload-pending" });
    await expect(readFile(state?.archive_artifact ?? "")).resolves.toBeTruthy();
  });

  it("preserves a committed profile archive on force-stop", async () => {
    // Given
    const fixture = await setup({
      cacheResult: {
        kind: "hit",
        archivePath: "/cache/cached.zip",
        reference: { ...identity, appOrigin: ORIGIN, profileId: PROFILE_ID },
      },
    });
    await fixture.coordinator.start(PROFILE_ID);
    // When
    await fixture.coordinator.forceStop(PROFILE_ID);
    // Then
    expect(fixture.removed).toHaveLength(0);
    expect(fixture.published).toHaveLength(0);
  });

  it("publishes exact committed upload identity before cleanup and reports progress", async () => {
    // Given
    const fixture = await setup({ remoteArchive: null });
    await fixture.coordinator.start(PROFILE_ID);
    // When
    await fixture.coordinator.stop(PROFILE_ID);
    // Then
    expect(fixture.published[0]?.reference).toMatchObject({
      appOrigin: ORIGIN,
      profileId: PROFILE_ID,
      generation: 4,
      format: "zip",
    });
    expect(fixture.counts()).toMatchObject({ uploads: 1, stops: 1 });
    expect(fixture.progress.map(({ value }) => value.direction)).toContain(
      "upload",
    );
    await expect(
      fixture.coordinator.store.load(PROFILE_ID),
    ).resolves.toBeNull();
  });

  it("reuses generation four after stop cleanup with zero download", async () => {
    // Given
    const uploaded = Buffer.from("uploaded-archive");
    const committedIdentity = {
      ...identity,
      size: uploaded.byteLength,
      sha256: createHash("sha256").update(uploaded).digest("hex"),
    };
    const fixture = await setup({
      realCache: true,
      remoteArchive: (start) => (start === 1 ? null : committedIdentity),
    });
    await fixture.coordinator.start(PROFILE_ID);
    await fixture.coordinator.stop(PROFILE_ID);
    // When
    await fixture.coordinator.start(PROFILE_ID);
    // Then
    expect(fixture.downloads).toHaveLength(0);
    expect(fixture.counts()).toMatchObject({ starts: 2, uploads: 1, stops: 1 });
    expect(
      fixture.archive.extracted.some((path) =>
        path.includes("profile-archives"),
      ),
    ).toBe(true);
  });

  it("repairs corrupt committed bytes with one download", async () => {
    // Given
    const uploaded = Buffer.from("uploaded-archive");
    const committedIdentity = {
      ...identity,
      size: uploaded.byteLength,
      sha256: createHash("sha256").update(uploaded).digest("hex"),
    };
    const fixture = await setup({
      realCache: true,
      downloadBytes: uploaded,
      remoteArchive: (start) => (start === 1 ? null : committedIdentity),
    });
    await fixture.coordinator.start(PROFILE_ID);
    await fixture.coordinator.stop(PROFILE_ID);
    const reference = {
      appOrigin: ORIGIN,
      profileId: PROFILE_ID,
      generation: committedIdentity.generation,
      size: committedIdentity.size,
      sha256: committedIdentity.sha256,
      format: "zip" as const,
    };
    const cached = await fixture.cache.resolve(reference);
    if (cached.kind !== "hit") throw new Error("expected committed cache hit");
    await writeFile(cached.archivePath, "corrupt");
    // When
    await fixture.coordinator.start(PROFILE_ID);
    // Then
    expect(fixture.downloads).toHaveLength(1);
    await expect(fixture.cache.resolve(reference)).resolves.toMatchObject({
      kind: "hit",
    });
  });

  it("keeps same-profile starts serialized", async () => {
    // Given
    const fixture = await setup({ remoteArchive: null });
    fixture.gateStarts();
    // When
    const first = fixture.coordinator.start(PROFILE_ID);
    const second = fixture.coordinator.start(PROFILE_ID);
    await Promise.resolve();
    fixture.releaseStart();
    await Promise.all([first, second]);
    // Then
    expect(fixture.counts().starts).toBe(1);
  });
});
