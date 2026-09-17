import {
  createCommandRunner,
  mapCommandResult,
  type AttentionCommandRunner,
} from "./command.js";
import type { AttentionAdapter, AttentionSound } from "./types.js";

const LINUX_SOUND_EVENTS = {
  default: "message-new-instant",
  subtle: "message",
  urgent: "dialog-warning",
} as const satisfies Record<AttentionSound, string>;

const sessionUnavailable = (output: string): boolean =>
  /cannot autolaunch|d-?bus|display|org\.freedesktop\.notifications/i.test(
    output,
  );

export function createLinuxAttentionAdapter(
  run: AttentionCommandRunner = createCommandRunner(),
): AttentionAdapter {
  return {
    notify: async (notification, signal) =>
      mapCommandResult(
        await run(
          {
            executable: "notify-send",
            args: [
              "--app-name=BrowserLogin",
              "--",
              notification.title,
              notification.message,
            ],
          },
          signal ? { signal } : undefined,
        ),
        sessionUnavailable,
      ),
    playSound: async (sound, signal) =>
      mapCommandResult(
        await run(
          {
            executable: "canberra-gtk-play",
            args: [
              "--id",
              LINUX_SOUND_EVENTS[sound],
              "--description",
              "BrowserLogin attention",
            ],
          },
          signal ? { signal } : undefined,
        ),
        sessionUnavailable,
      ),
  };
}
