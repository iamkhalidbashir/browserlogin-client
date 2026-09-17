export const ATTENTION_SOUNDS = ["default", "subtle", "urgent"] as const;

export type AttentionSound = (typeof ATTENTION_SOUNDS)[number];

export type AttentionNotification = {
  readonly title: string;
  readonly message: string;
};

export type AttentionOutcome =
  | { readonly status: "submitted" }
  | {
      readonly status: "unavailable";
      readonly reason: "executable_missing" | "session_unavailable";
    }
  | {
      readonly status: "failed";
      readonly reason: "launch_failed" | "timeout";
    }
  | {
      readonly status: "failed";
      readonly reason: "nonzero_exit";
      readonly exitCode: number;
    }
  | { readonly status: "cancelled" };

export interface AttentionAdapter {
  notify(
    notification: AttentionNotification,
    signal?: AbortSignal,
  ): Promise<AttentionOutcome>;
  playSound(
    sound: AttentionSound,
    signal?: AbortSignal,
  ): Promise<AttentionOutcome>;
}
