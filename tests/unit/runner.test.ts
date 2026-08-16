import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  createOneShotLaunchFile,
  protectedLaunchArgs,
  readAndDeleteLaunchFile,
  validateLaunchSpec,
} from "../../src/core/runner/launch.js";
import {
  AUTHORIZATION_MARKER,
  READY_MARKER,
} from "../../src/core/runner/types.js";
import {
  publishReady,
  waitForAuthorization,
  waitForReady,
} from "../../src/core/runner/protocol.js";
import type { LaunchSpec } from "../../src/core/runner/types.js";

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
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(spec);
    expect(await readAndDeleteLaunchFile(path)).toEqual(spec);
    await expect(stat(path)).rejects.toThrow();
    expect(() => validateLaunchSpec({ ...spec, unknown: true })).toThrow();
  });

  test("builds protected argv and rejects split or equals overrides", () => {
    expect(protectedLaunchArgs(spec)).toEqual([
      "--fingerprint=macos",
      "--disk-cache-dir=/tmp/browserlogin/profile-1/cache",
      "--disk-cache-size=536870912",
      "--fingerprint-noise=false",
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
    ]);
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

  test("requires exact gate and ready bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-protocol-"));
    const gate = join(root, "gate");
    const ready = join(root, "ready");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(gate, AUTHORIZATION_MARKER),
    );
    await waitForAuthorization(gate, 100);
    await publishReady(ready);
    await waitForReady(ready, 100);
    expect(READY_MARKER).toBe("browserlogin-runner-ready-v1\n");
  });
});
