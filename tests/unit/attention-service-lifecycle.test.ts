import { describe, expect, it } from "vitest";
import {
  ATTENTION_COOLDOWN_MS,
  createAttentionService,
} from "../../src/core/attention/index.js";
import type { AttentionOutcome } from "../../src/core/attention/types.js";
import {
  attentionSettings,
  deferred,
  fakeAttentionAdapter,
} from "./attention-test-support.js";

describe("attention service lifecycle", () => {
  it("propagates cancellation and shuts down active helpers once", async () => {
    // Given
    let aborts = 0;
    let now = 0;
    let notificationCalls = 0;
    const firstEntry = deferred<void>();
    const secondEntry = deferred<void>();
    const service = createAttentionService({
      readSettings: async () => attentionSettings("notification"),
      adapter: fakeAttentionAdapter({
        notify: (_notification, signal) => {
          notificationCalls += 1;
          if (notificationCalls === 1) firstEntry.resolve();
          else secondEntry.resolve();
          return new Promise<AttentionOutcome>((resolve) => {
            signal?.addEventListener(
              "abort",
              () => {
                aborts += 1;
                resolve({ status: "cancelled" });
              },
              { once: true },
            );
          });
        },
      }),
      now: () => now,
    });
    const caller = new AbortController();
    const cancelled = service.request({ message: "Cancel" }, caller.signal);
    await firstEntry.promise;
    caller.abort();
    await expect(cancelled).resolves.toEqual({
      code: "ATTENTION_CANCELLED",
      audio: "skipped",
      notification: "skipped",
    });
    now += ATTENTION_COOLDOWN_MS;
    const pendingShutdown = service.request({ message: "Continue" });
    await secondEntry.promise;

    // When
    await service.shutdown();
    await service.shutdown();

    // Then
    await expect(pendingShutdown).resolves.toEqual({
      code: "ATTENTION_CANCELLED",
      audio: "skipped",
      notification: "skipped",
    });
    expect(aborts).toBe(2);
    await expect(
      service.request({ message: "after shutdown" }),
    ).resolves.toEqual({
      code: "ATTENTION_UNAVAILABLE",
      audio: "skipped",
      notification: "skipped",
    });
  });
});
