import { describe, expect, test, vi } from "vitest";
import {
  createLaunchTiming,
  LAUNCH_TIMING_STAGES,
} from "../../src/core/launch-timing.js";

describe("launch timing diagnostics", () => {
  test("defines the complete ordered launch-stage catalog", () => {
    // Given
    const expected = [
      "profile-binary-preparation",
      "remote-session-start",
      "archive-download-restore",
      "runner-spawn",
      "socks-relay-ready",
      "cloakbrowser-context-launch",
      "cdp-readiness",
      "ui-cache-refresh",
    ];

    // When
    const stages = [...LAUNCH_TIMING_STAGES];

    // Then
    expect(stages).toEqual(expected);
  });

  test("emits monotonic stage durations only when explicitly enabled", () => {
    // Given
    const write = vi.fn<(value: string) => void>();
    const values = [100, 125, 190];
    const now = () => values.shift() ?? 190;
    const timing = createLaunchTiming({
      env: {
        BROWSERLOGIN_LAUNCH_TIMING: "1",
        BROWSERLOGIN_API_KEY: "must-not-escape",
        CLOAKBROWSER_LICENSE_KEY: "must-not-escape",
      },
      now,
      write,
    });

    // When
    timing.mark("profile-binary-preparation");
    timing.mark("remote-session-start");
    timing.mark("runner-spawn");

    // Then
    expect(write.mock.calls.map(([value]) => value)).toEqual([
      "[launch-timing] stage=profile-binary-preparation delta_ms=25 total_ms=25\n",
      "[launch-timing] stage=remote-session-start delta_ms=65 total_ms=90\n",
      "[launch-timing] stage=runner-spawn delta_ms=0 total_ms=90\n",
    ]);
    expect(write.mock.calls.flat().join(" ")).not.toContain("must-not-escape");
  });

  test("stays silent when the timing flag is absent", () => {
    // Given
    const write = vi.fn<(value: string) => void>();
    const timing = createLaunchTiming({ env: {}, now: () => 10, write });

    // When
    timing.mark("remote-session-start");

    // Then
    expect(write).not.toHaveBeenCalled();
  });
});
