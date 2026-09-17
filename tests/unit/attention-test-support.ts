import type { AttentionSettings } from "../../src/core/attention/index.js";
import type {
  AttentionAdapter,
  AttentionNotification,
  AttentionOutcome,
  AttentionSound,
} from "../../src/core/attention/types.js";

export const submitted: AttentionOutcome = { status: "submitted" };

export type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
};

export function deferred<T>(): Deferred<T> {
  let complete: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: complete };
}

export function attentionSettings(
  delivery: AttentionSettings["attention_delivery"] = "both",
  enabled = true,
): AttentionSettings {
  return {
    attention_enabled: enabled,
    attention_delivery: delivery,
    attention_sound: "urgent",
  };
}

export function fakeAttentionAdapter(
  options: {
    readonly notify?: (
      notification: AttentionNotification,
      signal?: AbortSignal,
    ) => Promise<AttentionOutcome>;
    readonly playSound?: (
      sound: AttentionSound,
      signal?: AbortSignal,
    ) => Promise<AttentionOutcome>;
  } = {},
): AttentionAdapter {
  return {
    notify: options.notify ?? (async () => submitted),
    playSound: options.playSound ?? (async () => submitted),
  };
}
