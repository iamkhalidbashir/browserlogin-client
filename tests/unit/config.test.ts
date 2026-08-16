import { readFile, stat, symlink, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KEYCHAIN_API_ACCOUNT, KEYCHAIN_SERVICE } from "../../src/shared/keychain-types";
import type { KeychainBackend } from "../../src/shared/keychain-types";
import { ConnectionStore, RecoveryPendingError, SetupRequiredError, connectionStatePaths, resolveConnection } from "../../src/core/config/connection";
import { migrateLegacyConnection } from "../../src/core/config/migrate";
import { ensureStatePaths, posixPathSecurity, resolveStateRoot, statePaths, windowsPathSecurity } from "../../src/core/config/paths";
import { ConfigCorruptError, atomicWriteJson } from "../../src/core/config/store";

const roots: string[] = [];

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "browserlogin-task9-"));
  roots.push(root);
  return root;
}

class FakeKeychain implements KeychainBackend {
  readonly values = new Map<string, string>();
  async get(key: { service: typeof KEYCHAIN_SERVICE; account: typeof KEYCHAIN_API_ACCOUNT }): Promise<string | null> {
    return this.values.get(`${key.service}/${key.account}`) ?? null;
  }
  async set(key: { service: typeof KEYCHAIN_SERVICE; account: typeof KEYCHAIN_API_ACCOUNT }, secret: string): Promise<void> {
    this.values.set(`${key.service}/${key.account}`, secret);
  }
  async delete(key: { service: typeof KEYCHAIN_SERVICE; account: typeof KEYCHAIN_API_ACCOUNT }): Promise<void> {
    this.values.delete(`${key.service}/${key.account}`);
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("state paths", () => {
  it("resolves the platform roots and absolute override", () => {
    expect(resolveStateRoot({ platform: "darwin", home: "/Users/test" })).toBe("/Users/test/Library/Application Support/BrowserLogin");
    expect(resolveStateRoot({ platform: "win32", home: "C:\\Users\\test", appData: "C:\\Users\\test\\AppData\\Roaming" })).toBe("C:\\Users\\test\\AppData\\Roaming\\BrowserLogin");
    expect(resolveStateRoot({ platform: "linux", home: "/home/test", env: {} })).toBe("/home/test/.local/state/browserlogin");
    expect(resolveStateRoot({ platform: "linux", home: "/home/test", env: { XDG_STATE_HOME: "/var/lib/test" } })).toBe("/var/lib/test/browserlogin");
    expect(resolveStateRoot({ env: { BROWSERLOGIN_STATE_DIR: "/tmp/browserlogin" } })).toBe("/tmp/browserlogin");
    expect(() => resolveStateRoot({ env: { BROWSERLOGIN_STATE_DIR: "relative" } })).toThrow("absolute");
    expect(Object.keys(statePaths("/tmp/browserlogin"))).toEqual(expect.arrayContaining([
      "root", "state", "locks", "work", "artifacts", "cache", "browser-cache", "launch", "gates", "controls", "ready", "logs", "connection", "connectionBackup", "connectionPending",
    ]));
  });

  it("creates every directory privately and rejects symlink roots", async () => {
    const root = await freshRoot();
    const paths = statePaths(join(root, "state-root"));
    await ensureStatePaths(paths);
    for (const name of ["root", "state", "locks", "work", "artifacts", "cache", "browser-cache", "launch", "gates", "controls", "ready", "logs"]) {
      expect((await stat(paths[name])).mode & 0o777).toBe(0o700);
    }
    const outside = join(root, "outside");
    await symlink(outside, join(root, "unsafe"));
    await expect(ensureStatePaths(statePaths(join(root, "unsafe")))).rejects.toThrow();
  });
});

describe("atomic config store", () => {
  it("writes 0600 JSON atomically and verifies the result", async () => {
    const root = await freshRoot();
    const paths = statePaths(join(root, "state-root"));
    await ensureStatePaths(paths);
    await atomicWriteJson(paths.connection, { schema_version: 2, base_url: "https://example.test/api/v1", key_ref: "keychain" });
    expect((await stat(paths.connection)).mode & 0o777).toBe(0o600);
    expect(await readFile(paths.connection, "utf8")).toContain('"key_ref": "keychain"');
    expect((await import("node:fs/promises")).readdir(paths.root)).resolves.not.toContain(expect.stringMatching(/\.tmp$/));
  });

  it("backs up corrupt JSON without preserving a raw secret", async () => {
    const root = await freshRoot();
    const paths = statePaths(join(root, "state-root"));
    await ensureStatePaths(paths);
    await writeFile(paths.connection, '{"api_key":"bl_secret_value",', { mode: 0o600 });
    const store = new ConnectionStore(paths.root, new FakeKeychain());
    await expect(store.read()).rejects.toMatchObject({ code: "CONFIG_CORRUPT" });
    await expect(readFile(paths.connectionBackup, "utf8")).resolves.not.toContain("bl_secret_value");
    await expect(store.read()).rejects.toBeInstanceOf(ConfigCorruptError);
  });
});

describe("connection migration and precedence", () => {
  it("migrates api_key into the injected keychain idempotently", async () => {
    const root = await freshRoot();
    const paths = statePaths(join(root, "state-root"));
    await ensureStatePaths(paths);
    await atomicWriteJson(paths.connection, { base_url: "https://example.test/api/v1", api_key: "bl_legacy_secret" });
    const keychain = new FakeKeychain();
    expect(await migrateLegacyConnection(paths, keychain)).toBe(true);
    expect(await migrateLegacyConnection(paths, keychain)).toBe(false);
    expect(await readFile(paths.connection, "utf8")).not.toContain("bl_legacy_secret");
    await expect(keychain.get({ service: KEYCHAIN_SERVICE, account: KEYCHAIN_API_ACCOUNT })).resolves.toBe("bl_legacy_secret");
  });

  it("applies CLI, nonempty env, persisted/keychain, then defaults", async () => {
    const root = await freshRoot();
    const paths = connectionStatePaths({ env: { BROWSERLOGIN_STATE_DIR: root } });
    const keychain = new FakeKeychain();
    await ensureStatePaths(paths);
    await atomicWriteJson(paths.connection, { schema_version: 2, base_url: "https://saved.test/api/v1", key_ref: "keychain" });
    await keychain.set({ service: KEYCHAIN_SERVICE, account: KEYCHAIN_API_ACCOUNT }, "bl_saved");
    await expect(resolveConnection({ paths, keychain, baseUrl: "https://cli.test/api/v1", apiKey: "bl_cli" })).resolves.toMatchObject({ source: "cli", apiKey: "bl_cli" });
    await expect(resolveConnection({ paths, keychain, env: { BROWSERLOGIN_BASE_URL: "https://env.test/api/v1", BROWSERLOGIN_API_KEY: "bl_env" } })).resolves.toMatchObject({ source: "env", apiKey: "bl_env" });
    await expect(resolveConnection({ paths, keychain, env: { BROWSERLOGIN_BASE_URL: "", BROWSERLOGIN_API_KEY: "" } })).resolves.toMatchObject({ source: "keychain", baseUrl: "https://saved.test/api/v1" });
    await rm(paths.connection, { force: true });
    await expect(resolveConnection({ paths, keychain, env: {} })).resolves.toMatchObject({ source: "default" });
  });

  it("blocks reconfiguration for setup-required and pending states", async () => {
    const root = await freshRoot();
    const keychain = new FakeKeychain();
    const store = new ConnectionStore(join(root, "state-root"), keychain);
    await store.initialize();
    await expect(store.assertReconfigurationAvailable()).rejects.toBeInstanceOf(SetupRequiredError);
    await atomicWriteJson(store.paths.connection, { schema_version: 2, base_url: "https://example.test/api/v1", key_ref: "keychain" });
    await atomicWriteJson(store.paths.connectionPending, { schema_version: 1, status: "pending" });
    await expect(store.assertReconfigurationAvailable()).rejects.toBeInstanceOf(RecoveryPendingError);
  });

  it("stores setup credentials in the keychain and only a marker on disk", async () => {
    const root = await freshRoot();
    const keychain = new FakeKeychain();
    const store = new ConnectionStore(join(root, "state-root"), keychain);
    await store.save("https://example.test/api/v1", "bl_setup_secret");
    expect(await readFile(store.paths.connection, "utf8")).not.toContain("bl_setup_secret");
    await expect(keychain.get({ service: KEYCHAIN_SERVICE, account: KEYCHAIN_API_ACCOUNT })).resolves.toBe("bl_setup_secret");
  });

  it("exposes the Windows ACL seam without changing POSIX mode behavior", async () => {
    const calls: string[] = [];
    const security = windowsPathSecurity({
      applyCurrentUserAcl: (path, directory) => { calls.push(`apply:${path}:${directory}`); },
      verifyCurrentUserAcl: (path, directory) => { calls.push(`verify:${path}:${directory}`); },
    });
    await security.secure("C:\\state", true);
    await security.verify("C:\\state", true);
    expect(calls).toEqual(["apply:C:\\state:true", "verify:C:\\state:true"]);
    expect(posixPathSecurity()).toHaveProperty("verify");
  });
});
