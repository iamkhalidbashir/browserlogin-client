import { describe, expect, it } from "vitest";
import {
  ATTENTION_COOLDOWN_MS,
  createAttentionService,
} from "../../src/core/attention/index.js";
import type { AttentionSound } from "../../src/core/attention/types.js";
import {
  attentionSettings,
  fakeAttentionAdapter,
  submitted,
} from "./attention-test-support.js";

describe("attention service settings", () => {
  it("re-reads settings and honors a newly enabled channel", async () => {
    // Given
    const configured = [
      attentionSettings("notification", false),
      attentionSettings("audio"),
    ];
    let reads = 0;
    const played: AttentionSound[] = [];
    const service = createAttentionService({
      readSettings: async () =>
        configured[reads++] ?? attentionSettings("audio"),
      adapter: fakeAttentionAdapter({
        playSound: async (sound) => {
          played.push(sound);
          return submitted;
        },
      }),
    });

    // When
    const disabled = await service.request({ message: "first" });
    const enabled = await service.request({ message: "second" });

    // Then
    expect(disabled).toEqual({
      code: "ATTENTION_DISABLED",
      audio: "skipped",
      notification: "skipped",
    });
    expect(enabled).toEqual({
      code: "ATTENTION_SUBMITTED",
      audio: "submitted",
      notification: "skipped",
    });
    expect(reads).toBe(2);
    expect(played).toEqual(["urgent"]);
  });

  it("enforces a five-second cooldown after dispatch starts", async () => {
    // Given
    let now = 10_000;
    let notifications = 0;
    const service = createAttentionService({
      readSettings: async () => attentionSettings("notification"),
      adapter: fakeAttentionAdapter({
        notify: async () => {
          notifications += 1;
          return submitted;
        },
      }),
      now: () => now,
    });

    // When
    const first = await service.request({ message: "first" });
    now += ATTENTION_COOLDOWN_MS - 1;
    const limited = await service.request({ message: "second" });
    now += 1;
    const afterCooldown = await service.request({ message: "third" });

    // Then
    expect(first.code).toBe("ATTENTION_SUBMITTED");
    expect(limited).toEqual({
      code: "ATTENTION_RATE_LIMITED",
      audio: "skipped",
      notification: "skipped",
    });
    expect(afterCooldown.code).toBe("ATTENTION_SUBMITTED");
    expect(notifications).toBe(2);
  });
});
