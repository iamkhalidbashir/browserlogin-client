import { z } from "zod";
import type { LocalSettings } from "../../shared/config-types.js";
import { createLinuxAttentionAdapter } from "./linux.js";
import { createMacOSAttentionAdapter } from "./macos.js";
import type {
  AttentionAdapter,
  AttentionOutcome,
  AttentionSound,
} from "./types.js";
import { createWindowsAttentionAdapter } from "./windows.js";

export const ATTENTION_COOLDOWN_MS = 5_000;

export const AttentionRequestSchema = z
  .object({
    title: z.string().min(1).max(80).default("BrowserLogin"),
    message: z.string().min(1).max(500),
  })
  .strict();

export const ATTENTION_RESULT_CODES = [
  "ATTENTION_SUBMITTED",
  "ATTENTION_PARTIAL",
  "ATTENTION_DISABLED",
  "ATTENTION_RATE_LIMITED",
  "ATTENTION_UNAVAILABLE",
  "ATTENTION_FAILED",
  "ATTENTION_INVALID_INPUT",
  "ATTENTION_CANCELLED",
] as const;

export type AttentionRequest = Readonly<z.infer<typeof AttentionRequestSchema>>;
export type AttentionResultCode = (typeof ATTENTION_RESULT_CODES)[number];
export type AttentionChannelStatus =
  "submitted" | "unavailable" | "failed" | "skipped";
export type AttentionResult = {
  readonly code: AttentionResultCode;
  readonly audio: AttentionChannelStatus;
  readonly notification: AttentionChannelStatus;
};
export type AttentionSettings = Readonly<
  Pick<
    LocalSettings,
    "attention_enabled" | "attention_delivery" | "attention_sound"
  >
>;

export interface AttentionService {
  request(input: unknown, signal?: AbortSignal): Promise<AttentionResult>;
  shutdown(): Promise<void>;
}

export type AttentionServiceOptions = {
  readonly readSettings: () => Promise<AttentionSettings>;
  readonly adapter: AttentionAdapter;
  readonly now?: () => number;
};

type RequestedChannels = {
  readonly audio: boolean;
  readonly notification: boolean;
};

type SettledChannel = {
  readonly status: AttentionChannelStatus;
  readonly cancelled: boolean;
};

const SKIPPED: AttentionResult = {
  code: "ATTENTION_UNAVAILABLE",
  audio: "skipped",
  notification: "skipped",
};

function skipped(code: AttentionResultCode): AttentionResult {
  return { ...SKIPPED, code };
}

function requestedChannels(
  delivery: AttentionSettings["attention_delivery"],
): RequestedChannels {
  switch (delivery) {
    case "audio":
      return { audio: true, notification: false };
    case "notification":
      return { audio: false, notification: true };
    case "both":
      return { audio: true, notification: true };
    default:
      return assertNever(delivery);
  }
}

function settledChannel(
  requested: boolean,
  result: PromiseSettledResult<AttentionOutcome>,
): SettledChannel {
  if (!requested) return { status: "skipped", cancelled: false };
  if (result.status === "rejected")
    return { status: "failed", cancelled: false };
  switch (result.value.status) {
    case "submitted":
      return { status: "submitted", cancelled: false };
    case "unavailable":
      return { status: "unavailable", cancelled: false };
    case "failed":
      return { status: "failed", cancelled: false };
    case "cancelled":
      return { status: "skipped", cancelled: true };
    default:
      return assertNever(result.value);
  }
}

function resultForChannels(
  audio: SettledChannel,
  notification: SettledChannel,
): AttentionResult {
  if (audio.cancelled || notification.cancelled)
    return {
      code: "ATTENTION_CANCELLED",
      audio: audio.status,
      notification: notification.status,
    };
  const configured = [audio.status, notification.status].filter(
    (status) => status !== "skipped",
  );
  const code: AttentionResultCode = configured.every(
    (status) => status === "submitted",
  )
    ? "ATTENTION_SUBMITTED"
    : configured.some((status) => status === "submitted")
      ? "ATTENTION_PARTIAL"
      : configured.every((status) => status === "unavailable")
        ? "ATTENTION_UNAVAILABLE"
        : "ATTENTION_FAILED";
  return { code, audio: audio.status, notification: notification.status };
}

async function dispatch(
  adapter: AttentionAdapter,
  request: AttentionRequest,
  settings: AttentionSettings,
  signal: AbortSignal,
): Promise<AttentionResult> {
  const channels = requestedChannels(settings.attention_delivery);
  const skippedOutcome: AttentionOutcome = { status: "cancelled" };
  const notification = channels.notification
    ? adapter.notify(request, signal)
    : Promise.resolve(skippedOutcome);
  const audio = channels.audio
    ? adapter.playSound(
        settings.attention_sound satisfies AttentionSound,
        signal,
      )
    : Promise.resolve(skippedOutcome);
  const [audioResult, notificationResult] = await Promise.allSettled([
    audio,
    notification,
  ]);
  return resultForChannels(
    settledChannel(channels.audio, audioResult),
    settledChannel(channels.notification, notificationResult),
  );
}

export function createAttentionService(
  options: AttentionServiceOptions,
): AttentionService {
  const now = options.now ?? Date.now;
  const active = new Map<AbortController, Promise<AttentionResult>>();
  let lastDispatchAt: number | undefined;
  let closed = false;
  let shutdownPromise: Promise<void> | undefined;

  return {
    async request(input, signal) {
      const parsed = AttentionRequestSchema.safeParse(input);
      if (!parsed.success) return skipped("ATTENTION_INVALID_INPUT");
      if (closed) return skipped("ATTENTION_UNAVAILABLE");
      const settingsResult = await options.readSettings().then(
        (value) => ({ status: "read", value }) as const,
        () => ({ status: "failed" }) as const,
      );
      if (settingsResult.status === "failed")
        return skipped("ATTENTION_FAILED");
      if (!settingsResult.value.attention_enabled)
        return skipped("ATTENTION_DISABLED");
      if (signal?.aborted) return skipped("ATTENTION_CANCELLED");
      if (closed) return skipped("ATTENTION_UNAVAILABLE");
      const requestedAt = now();
      if (
        lastDispatchAt !== undefined &&
        requestedAt - lastDispatchAt < ATTENTION_COOLDOWN_MS
      )
        return skipped("ATTENTION_RATE_LIMITED");
      lastDispatchAt = requestedAt;

      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      const pending = dispatch(
        options.adapter,
        parsed.data,
        settingsResult.value,
        controller.signal,
      );
      active.set(controller, pending);
      try {
        return await pending;
      } finally {
        signal?.removeEventListener("abort", onAbort);
        active.delete(controller);
      }
    },
    shutdown() {
      if (shutdownPromise) return shutdownPromise;
      closed = true;
      for (const controller of active.keys()) controller.abort();
      shutdownPromise = Promise.allSettled([...active.values()]).then(
        () => undefined,
      );
      return shutdownPromise;
    },
  };
}

export function createPlatformAttentionAdapter(
  platform: NodeJS.Platform = process.platform,
): AttentionAdapter {
  if (platform === "darwin") return createMacOSAttentionAdapter();
  if (platform === "win32") return createWindowsAttentionAdapter();
  return createLinuxAttentionAdapter();
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected attention variant: ${String(value)}`);
}
