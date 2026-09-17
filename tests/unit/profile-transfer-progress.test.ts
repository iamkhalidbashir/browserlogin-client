import { describe, expect, test, vi } from "vitest";
import { createMockBridge } from "../../src/mainview/mockBridge.js";
import {
  indexProfileTransferProgress,
  hasPendingProfileTransfer,
  profileTransferProgressQueryOptions,
  transferPresentation,
  type TransferProgressSnapshot,
} from "../../src/mainview/features/profiles/use-profile-transfer-progress.js";
import type { ProfileAction } from "../../src/mainview/features/profiles/profile-table.js";

const download: TransferProgressSnapshot = {
  profileId: "profile-a",
  direction: "download",
  transferred: 40,
  total: 100,
  percentage: 40,
  status: "running",
};
const upload: TransferProgressSnapshot = {
  profileId: "profile-b",
  direction: "upload",
  transferred: 65,
  total: 100,
  percentage: 65,
  status: "running",
};

describe("profile transfer progress query", () => {
  test("configures one all-profile request per interval and stops when relevant actions settle", async () => {
    // Given
    const bridge = createMockBridge({
      sessionsTransferProgress: [download, upload],
    });
    const request = vi.spyOn(bridge, "request");
    const active = profileTransferProgressQueryOptions(bridge, true);

    // When
    const snapshot = await active.queryFn();

    // Then
    expect(active.enabled).toBe(true);
    expect(active.refetchInterval).toBe(250);
    expect(snapshot).toEqual([download, upload]);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("sessionsTransferProgress", {});

    // When
    const settled = profileTransferProgressQueryOptions(bridge, false);

    // Then
    expect(settled.enabled).toBe(false);
    expect(settled.refetchInterval).toBe(false);
  });

  test.each<ProfileAction>(["force-stop", "rotate", "delete"])(
    "does not enable polling for %s",
    (action) => {
      // Given
      const pending = { "profile-a": action };

      // When
      const indexed = indexProfileTransferProgress([download, upload], pending);

      // Then
      expect(indexed).toEqual({});
      expect(hasPendingProfileTransfer(pending)).toBe(false);
    },
  );

  test.each<ProfileAction>(["launch", "stop"])(
    "enables polling for %s",
    (action) => {
      // Given
      const pending = { "profile-a": action };

      // When / Then
      expect(hasPendingProfileTransfer(pending)).toBe(true);
    },
  );
});

describe("profile transfer progress presentation", () => {
  test("indexes simultaneous rows only for their matching action direction", () => {
    // Given
    const pending = {
      "profile-a": "launch",
      "profile-b": "stop",
    } satisfies Readonly<Record<string, ProfileAction>>;

    // When
    const indexed = indexProfileTransferProgress([upload, download], pending);

    // Then
    expect(indexed).toEqual({
      "profile-a": download,
      "profile-b": upload,
    });
  });

  test("keeps launch and stop fallback labels for an empty cache-hit snapshot", () => {
    // Given
    const indexed = indexProfileTransferProgress([], { "profile-a": "launch" });

    // When
    const presentation = transferPresentation(
      "Research profile",
      "launch",
      indexed["profile-a"],
    );

    // Then
    expect(presentation).toBeNull();
  });

  test("presents completed transfer distinctly after the action settles", () => {
    // Given
    const completed: TransferProgressSnapshot = {
      ...download,
      transferred: 100,
      percentage: 100,
      status: "completed",
    };

    // When
    const presentation = transferPresentation(
      "Research profile",
      undefined,
      completed,
    );

    // Then
    expect(presentation).toMatchObject({
      label: "Downloaded 100%",
      accessibleName: "Research profile download progress",
      valueText: "Download completed at 100%",
      percentage: 100,
      state: "completed",
    });
  });

  test("presents failed upload at its delivered percentage and never as complete", () => {
    // Given
    const failed: TransferProgressSnapshot = {
      ...upload,
      status: "failed",
    };

    // When
    const presentation = transferPresentation(
      "Secondary profile",
      undefined,
      failed,
    );

    // Then
    expect(presentation).toMatchObject({
      label: "Upload failed at 65%",
      accessibleName: "Secondary profile upload progress",
      valueText: "Upload failed at 65%",
      percentage: 65,
      state: "failed",
    });
    expect(presentation?.percentage).not.toBe(100);
  });

  test("never shows download progress for stop or upload progress for launch", () => {
    // Given / When / Then
    expect(
      transferPresentation("Research profile", "stop", download),
    ).toBeNull();
    expect(
      transferPresentation("Secondary profile", "launch", upload),
    ).toBeNull();
  });

  test("does not present a running unverified transfer as complete", () => {
    // Given
    const unverified: TransferProgressSnapshot = {
      ...download,
      transferred: 100,
      percentage: 99,
    };

    // When
    const presentation = transferPresentation(
      "Research profile",
      "launch",
      unverified,
    );

    // Then
    expect(presentation).toMatchObject({
      label: "Downloading 99%",
      percentage: 99,
      state: "running",
    });
  });
});
