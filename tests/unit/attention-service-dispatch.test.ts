import { describe, expect, it } from "vitest";
import {
  createAttentionService,
  type AttentionChannelStatus,
  type AttentionResult,
} from "../../src/core/attention/index.js";
import type { AttentionOutcome } from "../../src/core/attention/types.js";
import {
  attentionSettings,
  deferred,
  fakeAttentionAdapter,
  submitted,
} from "./attention-test-support.js";

describe("attention service dispatch", () => {
  it("dispatches configured audio and notification channels concurrently", async () => {
    // Given
    const started: string[] = [];
    const bothEntered = deferred<void>();
    const notification = deferred<AttentionOutcome>();
    const audio = deferred<AttentionOutcome>();
    const service = createAttentionService({
      readSettings: async () => attentionSettings(),
      adapter: fakeAttentionAdapter({
        notify: async () => {
          started.push("notification");
          if (started.length === 2) bothEntered.resolve();
          return notification.promise;
        },
        playSound: async () => {
          started.push("audio");
          if (started.length === 2) bothEntered.resolve();
          return audio.promise;
        },
      }),
    });

    // When
    const pending = service.request({ title: "Sign in", message: "Continue" });
    await bothEntered.promise;

    // Then
    expect(started).toEqual(["notification", "audio"]);
    notification.resolve(submitted);
    audio.resolve(submitted);
    await expect(pending).resolves.toEqual({
      code: "ATTENTION_SUBMITTED",
      audio: "submitted",
      notification: "submitted",
    });
  });

  it.each([
    [
      { status: "submitted" },
      { status: "unavailable", reason: "executable_missing" },
      "ATTENTION_PARTIAL",
      "unavailable",
      "submitted",
    ],
    [
      { status: "unavailable", reason: "session_unavailable" },
      { status: "unavailable", reason: "executable_missing" },
      "ATTENTION_UNAVAILABLE",
      "unavailable",
      "unavailable",
    ],
    [
      { status: "failed", reason: "timeout" },
      { status: "unavailable", reason: "executable_missing" },
      "ATTENTION_FAILED",
      "unavailable",
      "failed",
    ],
    [
      { status: "cancelled" },
      { status: "submitted" },
      "ATTENTION_CANCELLED",
      "submitted",
      "skipped",
    ],
  ] satisfies readonly (readonly [
    AttentionOutcome,
    AttentionOutcome,
    AttentionResult["code"],
    AttentionChannelStatus,
    AttentionChannelStatus,
  ])[])(
    "maps channel outcomes to a stable result %#",
    async (notification, audio, code, audioStatus, notificationStatus) => {
      // Given
      const service = createAttentionService({
        readSettings: async () => attentionSettings(),
        adapter: fakeAttentionAdapter({
          notify: async () => notification,
          playSound: async () => audio,
        }),
      });

      // When
      const result = await service.request({ message: "Continue" });

      // Then
      expect(result).toEqual({
        code,
        audio: audioStatus,
        notification: notificationStatus,
      });
    },
  );
});
