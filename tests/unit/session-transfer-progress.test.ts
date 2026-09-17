import { describe, expect, test } from "vitest";
import {
  SessionTransferProgressStore,
  type SessionTransferProgressSnapshot,
} from "../../src/core/app/session-transfer-progress.js";

describe("SessionTransferProgressStore", () => {
  test("reports independent overlapping profile directions", () => {
    // Given
    const progress = new SessionTransferProgressStore();

    // When
    progress.record("profile-a", {
      direction: "download",
      transferred: 0,
      total: 100,
      done: false,
    });
    progress.record("profile-a", {
      direction: "download",
      transferred: 40,
      total: 100,
      done: false,
    });
    progress.record("profile-b", {
      direction: "upload",
      transferred: 0,
      total: 21,
      done: false,
    });
    progress.record("profile-b", {
      direction: "upload",
      transferred: 13,
      total: 21,
      done: false,
    });

    // Then
    expect(progress.snapshot()).toEqual([
      {
        profileId: "profile-a",
        direction: "download",
        transferred: 40,
        total: 100,
        percentage: 40,
        status: "running",
      },
      {
        profileId: "profile-b",
        direction: "upload",
        transferred: 13,
        total: 21,
        percentage: 61,
        status: "running",
      },
    ] satisfies readonly SessionTransferProgressSnapshot[]);
  });

  test("retains a failed count and resets only that attempt on retry", () => {
    // Given
    const progress = new SessionTransferProgressStore();
    progress.record("profile-a", {
      direction: "download",
      transferred: 0,
      total: 100,
      done: false,
    });
    progress.record("profile-a", {
      direction: "download",
      transferred: 63,
      total: 100,
      done: false,
    });
    progress.record("profile-b", {
      direction: "upload",
      transferred: 0,
      total: 10,
      done: false,
    });
    progress.record("profile-b", {
      direction: "upload",
      transferred: 5,
      total: 10,
      done: false,
    });

    // When
    progress.fail("profile-a", "download");
    const failed = progress.snapshot();
    progress.record("profile-a", {
      direction: "download",
      transferred: 0,
      total: 100,
      done: false,
    });

    // Then
    expect(failed).toContainEqual(
      expect.objectContaining({
        profileId: "profile-a",
        transferred: 63,
        percentage: 63,
        status: "failed",
      }),
    );
    expect(progress.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: "profile-a",
          transferred: 0,
          status: "running",
        }),
        expect.objectContaining({
          profileId: "profile-b",
          transferred: 5,
          status: "running",
        }),
      ]),
    );
  });

  test("returns terminal progress once and expires it after thirty seconds", () => {
    // Given
    let now = 1_000;
    const progress = new SessionTransferProgressStore({ now: () => now });
    progress.record("observed", {
      direction: "download",
      transferred: 0,
      total: 0,
      done: false,
    });
    progress.record("observed", {
      direction: "download",
      transferred: 0,
      total: 0,
      done: true,
    });
    progress.record("expired", {
      direction: "upload",
      transferred: 0,
      total: 10,
      done: false,
    });
    progress.record("expired", {
      direction: "upload",
      transferred: 10,
      total: 10,
      done: true,
    });

    // When
    const observed = progress.snapshot();
    progress.record("expired", {
      direction: "upload",
      transferred: 0,
      total: 10,
      done: false,
    });
    progress.record("expired", {
      direction: "upload",
      transferred: 10,
      total: 10,
      done: true,
    });
    now += 30_000;

    // Then
    expect(observed).toContainEqual(
      expect.objectContaining({
        profileId: "observed",
        percentage: 100,
        status: "completed",
      }),
    );
    expect(progress.snapshot()).toEqual([]);
  });

  test("rejects malformed and non-monotonic progress without changing state", () => {
    // Given
    const progress = new SessionTransferProgressStore();
    progress.record("profile-a", {
      direction: "download",
      transferred: 0,
      total: 10,
      done: false,
    });
    progress.record("profile-a", {
      direction: "download",
      transferred: 7,
      total: 10,
      done: false,
    });

    // When / Then
    expect(() =>
      progress.record("profile-a", {
        direction: "download",
        transferred: 6,
        total: 10,
        done: false,
      }),
    ).toThrow(TypeError);
    for (const malformed of [-1, 1.5, Number.POSITIVE_INFINITY, Number.NaN])
      expect(() =>
        progress.record("profile-b", {
          direction: "upload",
          transferred: malformed,
          total: 10,
          done: false,
        }),
      ).toThrow(TypeError);
    expect(progress.snapshot()).toEqual([
      expect.objectContaining({ transferred: 7, percentage: 70 }),
    ]);
  });

  test("requires zero to begin and reserves 100 percent for verified done", () => {
    // Given
    const progress = new SessionTransferProgressStore();

    // When / Then
    expect(() =>
      progress.record("profile-a", {
        direction: "download",
        transferred: 1,
        total: 10,
        done: false,
      }),
    ).toThrow(TypeError);
    progress.record("profile-a", {
      direction: "download",
      transferred: 0,
      total: 10,
      done: false,
    });
    progress.record("profile-a", {
      direction: "download",
      transferred: 15,
      total: 10,
      done: false,
    });
    expect(progress.snapshot()).toEqual([
      expect.objectContaining({ percentage: 99, status: "running" }),
    ]);
    progress.record("profile-a", {
      direction: "download",
      transferred: 15,
      total: 10,
      done: true,
    });
    expect(progress.snapshot()).toEqual([
      expect.objectContaining({ percentage: 100, status: "completed" }),
    ]);
  });
});
