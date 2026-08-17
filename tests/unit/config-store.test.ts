import { readFile, stat } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureStatePaths, statePaths } from "../../src/core/config/paths";
import { ConnectionStore } from "../../src/core/config/connection";
import { atomicWriteJson } from "../../src/core/config/store";
import type { KeychainBackend } from "../../src/shared/keychain-types";

class FakeKeychain implements KeychainBackend {
  async get(): Promise<string | null> {
    return null;
  }
  async set(): Promise<void> {
    return undefined;
  }
  async delete(): Promise<void> {
    return undefined;
  }
}

const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

describe("atomic config store", () => {
  it("writes private JSON atomically and verifies it", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-store-"));
    roots.push(root);
    const paths = statePaths(join(root, "state-root"));
    await ensureStatePaths(paths);
    await atomicWriteJson(paths.connection, {
      schema_version: 2,
      base_url: "https://example.test/api/v1",
      key_ref: "keychain",
    });
    if (process.platform !== "win32")
      expect((await stat(paths.connection)).mode & 0o777).toBe(0o600);
    expect(await readFile(paths.connection, "utf8")).toContain(
      '"key_ref": "keychain"',
    );
  });

  it("never writes a raw API secret to the connection file", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-store-secret-"));
    roots.push(root);
    const store = new ConnectionStore(
      join(root, "state-root"),
      new FakeKeychain(),
    );
    await store.save("https://example.test/api/v1", "bl_store_secret");
    expect(await readFile(store.paths.connection, "utf8")).not.toContain(
      "bl_store_secret",
    );
    expect(await readFile(store.paths.connection, "utf8")).toContain(
      "keychain",
    );
  });
});
