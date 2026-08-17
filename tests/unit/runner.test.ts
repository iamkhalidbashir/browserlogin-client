import { mkdtemp, readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  createOneShotLaunchFile,
  protectedLaunchArgs,
  readAndDeleteLaunchFile,
  validateLaunchSpec,
} from "../../src/core/runner/launch.js";
import { AUTHORIZATION_MARKER } from "../../src/core/runner/types.js";
import {
  publishReady,
  waitForAuthorization,
  waitForReady,
} from "../../src/core/runner/protocol.js";
import type { LaunchSpec } from "../../src/core/runner/types.js";

const launchFixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/launch-args.json", import.meta.url),
    "utf8",
  ),
) as {
  profiles: Array<{
    id: string;
    seed: number;
    platform: LaunchSpec["platform"];
    args: string[];
    expectedArgv: string[];
  }>;
};

const spec = {
  profile_id: "profile-1",
  seed: 12345,
  platform: "macos",
  geoip: true,
  humanize: true,
  human_preset: "careful",
  bumblebee_profile: "natural",
  headless: false,
  timezone: "America/New_York",
  locale: "en-US",
  user_agent: "test-agent",
  viewport: { width: 1440, height: 900 },
  args: ["--fingerprint-noise=false"],
  user_data_dir: "/tmp/browserlogin/profile-1/work",
  browser_cache_dir: "/tmp/browserlogin/profile-1/cache",
  browser_cache_max_bytes: 536870912,
  proxy: {
    protocol: "http",
    host: "proxy.test",
    port: 8080,
    username: "user",
    password: "TEST-ONLY-password",
  },
} as const satisfies LaunchSpec;

describe("runner launch protocol", () => {
  test("persists the exact strict payload privately and deletes it after read", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-runner-"));
    const path = join(root, "launch.json");
    await createOneShotLaunchFile(path, spec);
    if (process.platform !== "win32")
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(spec);
    expect(await readAndDeleteLaunchFile(path)).toEqual(spec);
    await expect(stat(path)).rejects.toThrow();
    expect(() => validateLaunchSpec({ ...spec, unknown: true })).toThrow();
  });

  test("builds protected argv and rejects split or equals overrides", () => {
    const expected = launchFixture.profiles.find(
      (profile) => profile.id === "profile-1",
    );
    expect(expected).toBeDefined();
    expect(protectedLaunchArgs(spec)).toEqual(expected?.expectedArgv);
    for (const profile of launchFixture.profiles) {
      const profileSpec: LaunchSpec = {
        ...spec,
        profile_id: profile.id,
        seed: profile.seed,
        platform: profile.platform,
        args: profile.args,
        browser_cache_dir:
          profile.id === "profile-3"
            ? "C:/BrowserLogin/profile-3/cache"
            : `/tmp/browserlogin/${profile.id}/cache`,
        proxy: null,
      };
      expect(protectedLaunchArgs(profileSpec)).toEqual(profile.expectedArgv);
    }
    expect(() =>
      protectedLaunchArgs({
        ...spec,
        args: ["--disk-cache-dir", "/tmp/other"],
      }),
    ).toThrow();
    expect(() =>
      protectedLaunchArgs({ ...spec, args: ["--remote-debugging-port=9"] }),
    ).toThrow();
  });

  test("requires exact gate bytes and a validated loopback ready record", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-protocol-"));
    const gate = join(root, "gate");
    const ready = join(root, "ready");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(gate, AUTHORIZATION_MARKER),
    );
    await waitForAuthorization(gate, 100);
    await publishReady(ready, {
      version: 1,
      relayCdpUrl: "ws://127.0.0.1:43123",
    });
    expect(await waitForReady(ready, 100)).toEqual({
      version: 1,
      relayCdpUrl: "ws://127.0.0.1:43123/",
    });
    await expect(
      publishReady(ready, {
        version: 1,
        relayCdpUrl: "ws://example.test:43123",
      }),
    ).rejects.toThrow("runner relay URL is invalid");
  });
});
