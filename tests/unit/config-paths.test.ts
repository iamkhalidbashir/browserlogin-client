import { stat, symlink } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureStatePaths,
  resolveStateRoot,
  statePaths,
} from "../../src/core/config/paths";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("config path roots", () => {
  it("resolves all supported platform roots and rejects relative overrides", () => {
    expect(resolveStateRoot({ platform: "darwin", home: "/Users/test" })).toBe(
      "/Users/test/Library/Application Support/BrowserLogin",
    );
    expect(
      resolveStateRoot({
        platform: "win32",
        home: "C:\\Users\\test",
        appData: "C:\\Users\\test\\AppData\\Roaming",
      }),
    ).toBe("C:\\Users\\test\\AppData\\Roaming\\BrowserLogin");
    expect(
      resolveStateRoot({ platform: "linux", home: "/home/test", env: {} }),
    ).toBe("/home/test/.local/state/browserlogin");
    expect(
      resolveStateRoot({
        platform: "linux",
        home: "/home/test",
        env: { XDG_STATE_HOME: "/var/lib/test" },
      }),
    ).toBe("/var/lib/test/browserlogin");
    expect(
      resolveStateRoot({
        platform: "linux",
        env: { BROWSERLOGIN_STATE_DIR: "/tmp/browserlogin" },
      }),
    ).toBe("/tmp/browserlogin");
    expect(() =>
      resolveStateRoot({
        platform: "linux",
        env: { BROWSERLOGIN_STATE_DIR: "relative" },
      }),
    ).toThrow("absolute");
  });

  it("creates private planned directories and rejects a symlink root", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-paths-"));
    roots.push(root);
    const paths = statePaths(join(root, "state-root"));
    await ensureStatePaths(paths);
    for (const name of [
      "root",
      "state",
      "locks",
      "work",
      "artifacts",
      "cache",
      "browser-cache",
      "launch",
      "gates",
      "controls",
      "ready",
      "logs",
    ]) {
      if (process.platform !== "win32")
        expect((await stat(paths[name])).mode & 0o777).toBe(0o700);
    }
    await symlink(join(root, "outside"), join(root, "unsafe"));
    await expect(
      ensureStatePaths(statePaths(join(root, "unsafe"))),
    ).rejects.toThrow();
  });
});
