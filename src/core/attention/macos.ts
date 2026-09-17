import {
  createCommandRunner,
  mapCommandResult,
  type AttentionCommandRunner,
} from "./command.js";
import type { AttentionAdapter, AttentionSound } from "./types.js";

export const MACOS_NOTIFICATION_SCRIPT = `on run argv
  set notificationTitle to item 1 of argv
  set notificationBody to item 2 of argv
  display notification notificationBody with title notificationTitle
end run`;

const MACOS_SOUND_ASSETS = {
  default: "/System/Library/Sounds/Glass.aiff",
  subtle: "/System/Library/Sounds/Pop.aiff",
  urgent: "/System/Library/Sounds/Basso.aiff",
} as const satisfies Record<AttentionSound, string>;

const sessionUnavailable = (output: string): boolean =>
  /not logged in|loginwindow|no user interaction|connection is invalid/i.test(
    output,
  );

export function createMacOSAttentionAdapter(
  run: AttentionCommandRunner = createCommandRunner(),
): AttentionAdapter {
  return {
    notify: async (notification, signal) =>
      mapCommandResult(
        await run(
          {
            executable: "/usr/bin/osascript",
            args: [
              "-e",
              MACOS_NOTIFICATION_SCRIPT,
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
            executable: "/usr/bin/afplay",
            args: [MACOS_SOUND_ASSETS[sound]],
          },
          signal ? { signal } : undefined,
        ),
        sessionUnavailable,
      ),
  };
}
