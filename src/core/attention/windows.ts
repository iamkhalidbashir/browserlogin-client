import {
  createCommandRunner,
  mapCommandResult,
  type AttentionCommandRunner,
} from "./command.js";
import type { AttentionAdapter, AttentionSound } from "./types.js";

export const WINDOWS_ATTENTION_DATA_ENV = "BROWSERLOGIN_ATTENTION_DATA";
export const WINDOWS_POWERSHELL_ARGS = [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
] as const;

export const WINDOWS_ATTENTION_SCRIPT = `$ErrorActionPreference = 'Stop'
$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:BROWSERLOGIN_ATTENTION_DATA))
$data = $json | ConvertFrom-Json
if ($data.kind -eq 'notification') {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $notification = New-Object System.Windows.Forms.NotifyIcon
  try {
    $notification.Icon = [System.Drawing.SystemIcons]::Information
    $notification.Visible = $true
    $notification.BalloonTipTitle = [string]$data.title
    $notification.BalloonTipText = [string]$data.message
    $notification.ShowBalloonTip(3000)
    Start-Sleep -Milliseconds 1000
  } finally {
    $notification.Dispose()
  }
} elseif ($data.kind -eq 'sound') {
  switch ([string]$data.sound) {
    'Asterisk' { [System.Media.SystemSounds]::Asterisk.Play() }
    'Beep' { [System.Media.SystemSounds]::Beep.Play() }
    'Exclamation' { [System.Media.SystemSounds]::Exclamation.Play() }
    default { exit 64 }
  }
} else {
  exit 64
}`;

const WINDOWS_SYSTEM_SOUNDS = {
  default: "Asterisk",
  subtle: "Beep",
  urgent: "Exclamation",
} as const satisfies Record<AttentionSound, string>;

const sessionUnavailable = (output: string): boolean =>
  /interactive window station|no interactive user|session.*unavailable|explorer.*not running/i.test(
    output,
  );

type WindowsAttentionData =
  | {
      readonly kind: "notification";
      readonly title: string;
      readonly message: string;
    }
  | {
      readonly kind: "sound";
      readonly sound: (typeof WINDOWS_SYSTEM_SOUNDS)[AttentionSound];
    };

function encodedData(data: WindowsAttentionData): string {
  return Buffer.from(JSON.stringify(data), "utf8").toString("base64");
}

export function createWindowsAttentionAdapter(
  run: AttentionCommandRunner = createCommandRunner(),
): AttentionAdapter {
  return {
    notify: async (notification, signal) =>
      mapCommandResult(
        await run(
          {
            executable: "powershell.exe",
            args: [...WINDOWS_POWERSHELL_ARGS, WINDOWS_ATTENTION_SCRIPT],
            env: {
              ...process.env,
              [WINDOWS_ATTENTION_DATA_ENV]: encodedData({
                kind: "notification",
                title: notification.title,
                message: notification.message,
              }),
            },
          },
          signal ? { signal } : undefined,
        ),
        sessionUnavailable,
      ),
    playSound: async (sound, signal) =>
      mapCommandResult(
        await run(
          {
            executable: "powershell.exe",
            args: [...WINDOWS_POWERSHELL_ARGS, WINDOWS_ATTENTION_SCRIPT],
            env: {
              ...process.env,
              [WINDOWS_ATTENTION_DATA_ENV]: encodedData({
                kind: "sound",
                sound: WINDOWS_SYSTEM_SOUNDS[sound],
              }),
            },
          },
          signal ? { signal } : undefined,
        ),
        sessionUnavailable,
      ),
  };
}
