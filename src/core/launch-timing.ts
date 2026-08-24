export const LAUNCH_TIMING_STAGES = [
  "profile-binary-preparation",
  "remote-session-start",
  "archive-download-restore",
  "runner-spawn",
  "socks-relay-ready",
  "cloakbrowser-context-launch",
  "cdp-readiness",
  "ui-cache-refresh",
] as const;

export type LaunchTimingStage = (typeof LAUNCH_TIMING_STAGES)[number];

type LaunchTimingOptions = {
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly now?: () => number;
  readonly write?: (value: string) => void;
};

export type LaunchTiming = {
  mark(stage: LaunchTimingStage): void;
};

export function createLaunchTiming(options: LaunchTimingOptions): LaunchTiming {
  const enabled = options.env.BROWSERLOGIN_LAUNCH_TIMING === "1";
  const now = options.now ?? (() => performance.now());
  const write = options.write ?? ((value: string) => process.stderr.write(value));
  const startedAt = now();
  let previousAt = startedAt;
  return {
    mark(stage) {
      if (!enabled) return;
      const currentAt = now();
      const deltaMs = Math.round(currentAt - previousAt);
      const totalMs = Math.round(currentAt - startedAt);
      previousAt = currentAt;
      write(
        `[launch-timing] stage=${stage} delta_ms=${deltaMs} total_ms=${totalMs}\n`,
      );
    },
  };
}
