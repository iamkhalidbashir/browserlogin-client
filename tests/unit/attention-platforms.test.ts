import { describe, expect, it } from "vitest";
import {
  createLinuxAttentionAdapter,
  createMacOSAttentionAdapter,
  createWindowsAttentionAdapter,
} from "../../src/core/attention/index.js";
import {
  type AttentionCommand,
  type AttentionCommandResult,
  type AttentionCommandRunner,
} from "../../src/core/attention/command.js";
import { MACOS_NOTIFICATION_SCRIPT } from "../../src/core/attention/macos.js";
import {
  WINDOWS_ATTENTION_DATA_ENV,
  WINDOWS_ATTENTION_SCRIPT,
  WINDOWS_POWERSHELL_ARGS,
} from "../../src/core/attention/windows.js";

const completed = (
  exitCode = 0,
  stderr = "",
): AttentionCommandResult => ({
  status: "completed",
  exitCode,
  stdout: "",
  stderr,
});

function recordingRunner(result: AttentionCommandResult = completed()): {
  readonly calls: AttentionCommand[];
  readonly runner: AttentionCommandRunner;
} {
  const calls: AttentionCommand[] = [];
  return {
    calls,
    runner: async (command) => {
      calls.push(command);
      return result;
    },
  };
}

describe("macOS attention adapter", () => {
  it("passes notification data only as osascript argv", async () => {
    // Given
    const title = `title' & do shell script "touch /tmp/pwned"`;
    const message = "body\n$(open /Applications/Calculator.app)";
    const capture = recordingRunner();
    const adapter = createMacOSAttentionAdapter(capture.runner);

    // When
    const result = await adapter.notify({ title, message });

    // Then
    expect(capture.calls).toEqual([
      {
        executable: "/usr/bin/osascript",
        args: ["-e", MACOS_NOTIFICATION_SCRIPT, "--", title, message],
      },
    ]);
    expect(MACOS_NOTIFICATION_SCRIPT).not.toContain(title);
    expect(MACOS_NOTIFICATION_SCRIPT).not.toContain(message);
    expect(result).toEqual({ status: "submitted" });
  });

  it.each([
    ["default", "/System/Library/Sounds/Glass.aiff"],
    ["subtle", "/System/Library/Sounds/Pop.aiff"],
    ["urgent", "/System/Library/Sounds/Basso.aiff"],
  ] as const)("maps %s to a fixed afplay asset", async (sound, asset) => {
    // Given
    const capture = recordingRunner();
    const adapter = createMacOSAttentionAdapter(capture.runner);

    // When
    const result = await adapter.playSound(sound);

    // Then
    expect(capture.calls).toEqual([
      { executable: "/usr/bin/afplay", args: [asset] },
    ]);
    expect(result).toEqual({ status: "submitted" });
  });
});

describe("Windows attention adapter", () => {
  it("passes notification data as base64 JSON in the environment", async () => {
    // Given
    const input = {
      title: `'; Start-Process calc; #'`,
      message: '"; [IO.File]::WriteAllText("pwned", "1")',
    };
    const capture = recordingRunner();
    const adapter = createWindowsAttentionAdapter(capture.runner);

    // When
    const result = await adapter.notify(input);

    // Then
    expect(capture.calls).toHaveLength(1);
    const command = capture.calls.at(0);
    expect(command?.executable).toBe("powershell.exe");
    expect(command?.args).toEqual([
      ...WINDOWS_POWERSHELL_ARGS,
      WINDOWS_ATTENTION_SCRIPT,
    ]);
    expect(command?.args.join(" ")).not.toContain(input.title);
    expect(command?.args.join(" ")).not.toContain(input.message);
    const encoded = command?.env?.[WINDOWS_ATTENTION_DATA_ENV] ?? "";
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe(
      JSON.stringify({ kind: "notification", ...input }),
    );
    expect(result).toEqual({ status: "submitted" });
  });

  it("drops runtime discriminator and sound fields from notifications", async () => {
    // Given
    const input = {
      title: "Expected title",
      message: "Expected message",
      kind: "sound",
      sound: "Asterisk",
    } as const;
    const capture = recordingRunner();
    const adapter = createWindowsAttentionAdapter(capture.runner);

    // When
    await adapter.notify(input);

    // Then
    const encoded =
      capture.calls.at(0)?.env?.[WINDOWS_ATTENTION_DATA_ENV] ?? "";
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe(
      JSON.stringify({
        kind: "notification",
        title: input.title,
        message: input.message,
      }),
    );
  });

  it.each([
    ["default", "Asterisk"],
    ["subtle", "Beep"],
    ["urgent", "Exclamation"],
  ] as const)("maps %s to SystemSounds.%s", async (sound, systemSound) => {
    // Given
    const capture = recordingRunner();
    const adapter = createWindowsAttentionAdapter(capture.runner);

    // When
    await adapter.playSound(sound);

    // Then
    const encoded =
      capture.calls.at(0)?.env?.[WINDOWS_ATTENTION_DATA_ENV] ?? "";
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe(
      JSON.stringify({ kind: "sound", sound: systemSound }),
    );
  });
});

describe("Linux attention adapter", () => {
  it("passes notification data as literal notify-send argv", async () => {
    // Given
    const input = { title: "--icon=/tmp/evil", message: "$(touch /tmp/pwned)" };
    const capture = recordingRunner();
    const adapter = createLinuxAttentionAdapter(capture.runner);

    // When
    const result = await adapter.notify(input);

    // Then
    expect(capture.calls).toEqual([
      {
        executable: "notify-send",
        args: ["--app-name=BrowserLogin", "--", input.title, input.message],
      },
    ]);
    expect(result).toEqual({ status: "submitted" });
  });

  it.each([
    ["default", "message-new-instant"],
    ["subtle", "message"],
    ["urgent", "dialog-warning"],
  ] as const)("maps %s to allowlisted event %s", async (sound, eventId) => {
    // Given
    const capture = recordingRunner();
    const adapter = createLinuxAttentionAdapter(capture.runner);

    // When
    await adapter.playSound(sound);

    // Then
    expect(capture.calls).toEqual([
      {
        executable: "canberra-gtk-play",
        args: ["--id", eventId, "--description", "BrowserLogin attention"],
      },
    ]);
  });

  it.each([
    [
      { status: "unavailable", reason: "executable_missing" },
      { status: "unavailable", reason: "executable_missing" },
    ],
    [
      completed(1, "Cannot autolaunch D-Bus without X11 $DISPLAY"),
      { status: "unavailable", reason: "session_unavailable" },
    ],
    [completed(3, "native command rejected"), { status: "failed", reason: "nonzero_exit", exitCode: 3 }],
    [{ status: "timed_out" }, { status: "failed", reason: "timeout" }],
    [{ status: "cancelled" }, { status: "cancelled" }],
  ] satisfies readonly (readonly [AttentionCommandResult, object])[])(
    "maps command outcome %# without losing its category",
    async (commandResult, expected) => {
      // Given
      const adapter = createLinuxAttentionAdapter(
        recordingRunner(commandResult).runner,
      );

      // When
      const result = await adapter.notify({ title: "title", message: "body" });

      // Then
      expect(result).toEqual(expected);
    },
  );
});
