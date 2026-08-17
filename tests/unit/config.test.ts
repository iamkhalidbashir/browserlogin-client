import { readFile, stat, symlink, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  KEYCHAIN_API_ACCOUNT,
  KEYCHAIN_LICENSE_ACCOUNT,
  KEYCHAIN_SERVICE,
} from "../../src/shared/keychain-types";
import type {
  KeychainBackend,
  KeychainServiceAccount,
} from "../../src/shared/keychain-types";
import {
  ConnectionStore,
  RecoveryPendingError,
  SetupRequiredError,
  connectionStatePaths,
  resolveConnection,
} from "../../src/core/config/connection";
import { migrateLegacyConnection } from "../../src/core/config/migrate";
import {
  ensureStatePaths,
  posixPathSecurity,
  resolveStateRoot,
  statePaths,
  windowsPathSecurity,
} from "../../src/core/config/paths";
import {
  ConfigCorruptError,
  atomicWriteJson,
} from "../../src/core/config/store";

const roots: string[] = [];

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "browserlogin-task9-"));
  roots.push(root);
  return root;
}

class FakeKeychain implements KeychainBackend {
  readonly values = new Map<string, string>();
  setCalls = 0;
  async get(key: KeychainServiceAccount): Promise<string | null> {
    return this.values.get(`${key.service}/${key.account}`) ?? null;
  }
  async set(key: KeychainServiceAccount, secret: string): Promise<void> {
    this.setCalls += 1;
    this.values.set(`${key.service}/${key.account}`, secret);
  }
  async delete(key: KeychainServiceAccount): Promise<void> {
    this.values.delete(`${key.service}/${key.account}`);
  }
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("state paths", () => {
  it("resolves the platform roots and absolute override", () => {
    expect(resolveStateRoot({ platform: "darwin", home: "/Users/test" })).toBe(
      "/Users/test/Library/Application Support/BrowserLogin",
    );
    expect(
      resolveStateRoot({
        platform: "win32",
        home: "C:\\Users\\test",
        env: {
          LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
          APPDATA: "C:\\Users\\test\\AppData\\Roaming",
        },
      }),
    ).toBe("C:\\Users\\test\\AppData\\Local\\BrowserLogin");
    expect(
      resolveStateRoot({
        platform: "win32",
        home: "C:\\Users\\test",
        appData: "C:\\Users\\test\\AppData\\Custom",
      }),
    ).toBe("C:\\Users\\test\\AppData\\Custom\\BrowserLogin");
    expect(
      resolveStateRoot({
        platform: "win32",
        home: "C:\\Users\\test",
        env: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
      }),
    ).toBe("C:\\Users\\test\\AppData\\Local\\BrowserLogin");
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
    expect(Object.keys(statePaths(join(tmpdir(), "browserlogin")))).toEqual(
      expect.arrayContaining([
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
        "connection",
        "connectionBackup",
        "connectionPending",
      ]),
    );
  });

  it("creates every directory privately and rejects symlink roots", async () => {
    const root = await freshRoot();
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
    const outside = join(root, "outside");
    await symlink(outside, join(root, "unsafe"));
    await expect(
      ensureStatePaths(statePaths(join(root, "unsafe"))),
    ).rejects.toThrow();
  });
});

describe("atomic config store", () => {
  it("writes 0600 JSON atomically and verifies the result", async () => {
    const root = await freshRoot();
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
    await expect(
      (await import("node:fs/promises")).readdir(paths.root),
    ).resolves.not.toContain(expect.stringMatching(/\.tmp$/));
  });

  it("backs up corrupt JSON without preserving a raw secret", async () => {
    const root = await freshRoot();
    const paths = statePaths(join(root, "state-root"));
    await ensureStatePaths(paths);
    await writeFile(paths.connection, '{"api_key":"bl_secret_value",', {
      mode: 0o600,
    });
    const store = new ConnectionStore(paths.root, new FakeKeychain());
    await expect(store.read()).rejects.toMatchObject({
      code: "CONFIG_CORRUPT",
    });
    await expect(
      readFile(paths.connectionBackup, "utf8"),
    ).resolves.not.toContain("bl_secret_value");
    await expect(store.read()).rejects.toBeInstanceOf(ConfigCorruptError);
  });
});

describe("connection migration and precedence", () => {
  it("migrates api_key into the injected keychain idempotently", async () => {
    const root = await freshRoot();
    const paths = statePaths(join(root, "state-root"));
    await ensureStatePaths(paths);
    await atomicWriteJson(paths.connection, {
      base_url: "https://example.test/api/v1",
      api_key: "bl_legacy_secret",
    });
    const keychain = new FakeKeychain();
    expect(await migrateLegacyConnection(paths, keychain)).toBe(true);
    expect(await migrateLegacyConnection(paths, keychain)).toBe(false);
    expect(await readFile(paths.connection, "utf8")).not.toContain(
      "bl_legacy_secret",
    );
    await expect(
      keychain.get({
        service: KEYCHAIN_SERVICE,
        account: KEYCHAIN_API_ACCOUNT,
      }),
    ).resolves.toBe("bl_legacy_secret");
  });

  it("migrates a schema-v2 file that still contains api_key and does not re-store it", async () => {
    const root = await freshRoot();
    const paths = statePaths(join(root, "state-root"));
    await ensureStatePaths(paths);
    await atomicWriteJson(paths.connection, {
      schema_version: 2,
      base_url: "https://x",
      api_key: "bl_test_secret",
    });
    const keychain = new FakeKeychain();
    expect(await migrateLegacyConnection(paths, keychain)).toBe(true);
    expect(JSON.parse(await readFile(paths.connection, "utf8"))).toEqual({
      schema_version: 2,
      base_url: "https://x",
      key_ref: "keychain",
    });
    expect(keychain.setCalls).toBe(1);
    expect(await migrateLegacyConnection(paths, keychain)).toBe(false);
    expect(keychain.setCalls).toBe(1);
  });

  it("validates legacy URL and API-key shape before touching the keychain", async () => {
    const root = await freshRoot();
    const paths = statePaths(join(root, "state-root"));
    await ensureStatePaths(paths);
    const keychain = new FakeKeychain();
    await atomicWriteJson(paths.connection, {
      schema_version: 2,
      base_url: "http://x",
      api_key: "bl_test_secret",
    });
    await expect(migrateLegacyConnection(paths, keychain)).rejects.toThrow();
    expect(keychain.setCalls).toBe(0);
    await atomicWriteJson(paths.connection, {
      schema_version: 2,
      base_url: "https://x",
      api_key: "invalid",
    });
    await expect(migrateLegacyConnection(paths, keychain)).rejects.toThrow();
    expect(keychain.setCalls).toBe(0);
  });

  it("applies CLI, nonempty env, persisted/keychain, then defaults", async () => {
    const root = await freshRoot();
    const paths = connectionStatePaths({
      env: { BROWSERLOGIN_STATE_DIR: root },
    });
    const keychain = new FakeKeychain();
    await ensureStatePaths(paths);
    await atomicWriteJson(paths.connection, {
      schema_version: 2,
      base_url: "https://saved.test/api/v1",
      key_ref: "keychain",
    });
    await keychain.set(
      { service: KEYCHAIN_SERVICE, account: KEYCHAIN_API_ACCOUNT },
      "bl_saved_secret",
    );
    await expect(
      resolveConnection({
        paths,
        keychain,
        baseUrl: "https://cli.test/api/v1",
        apiKey: "bl_cli_secret",
      }),
    ).resolves.toMatchObject({ source: "cli", apiKey: "bl_cli_secret" });
    await expect(
      resolveConnection({
        paths,
        keychain,
        env: {
          BROWSERLOGIN_BASE_URL: "https://env.test/api/v1",
          BROWSERLOGIN_API_KEY: "bl_env_secret",
        },
      }),
    ).resolves.toMatchObject({ source: "env", apiKey: "bl_env_secret" });
    await expect(
      resolveConnection({
        paths,
        keychain,
        env: {
          BROWSERLOGIN_BASE_URL: "",
          BROWSERLOGIN_API_KEY: "",
          CLOAKBROWSER_LICENSE_KEY: "",
        },
      }),
    ).resolves.toMatchObject({
      source: "keychain",
      baseUrl: "https://saved.test/api/v1",
      licenseKey: null,
    });
    await rm(paths.connection, { force: true });
    keychain.values.clear();
    await expect(
      resolveConnection({ paths, keychain, env: {} }),
    ).resolves.toMatchObject({ source: "default" });
  });

  it("resolves license keys as CLI, env, keychain, then null without using a license API URL", async () => {
    const root = await freshRoot();
    const paths = statePaths(join(root, "state-root"));
    await ensureStatePaths(paths);
    const keychain = new FakeKeychain();
    await keychain.set(
      { service: KEYCHAIN_SERVICE, account: KEYCHAIN_LICENSE_ACCOUNT },
      "license-keychain",
    );
    await expect(
      resolveConnection({
        paths,
        keychain,
        licenseKey: "license-cli",
        env: {
          CLOAKBROWSER_LICENSE_KEY: "license-env",
          CLOAKBROWSER_LICENSE_API: "https://relay.invalid",
        },
      }),
    ).resolves.toMatchObject({ licenseKey: "license-cli" });
    await expect(
      resolveConnection({
        paths,
        keychain,
        env: { CLOAKBROWSER_LICENSE_KEY: "license-env" },
      }),
    ).resolves.toMatchObject({ licenseKey: "license-env" });
    await expect(
      resolveConnection({ paths, keychain, env: {} }),
    ).resolves.toMatchObject({ licenseKey: "license-keychain" });
    await expect(
      resolveConnection({
        paths,
        keychain,
        env: { CLOAKBROWSER_LICENSE_KEY: "" },
      }),
    ).resolves.toMatchObject({ licenseKey: "license-keychain" });
    keychain.values.delete(`${KEYCHAIN_SERVICE}/${KEYCHAIN_LICENSE_ACCOUNT}`);
    await expect(
      resolveConnection({
        paths,
        keychain,
        env: { CLOAKBROWSER_LICENSE_KEY: "" },
      }),
    ).resolves.toMatchObject({ licenseKey: null });
  });

  it("blocks reconfiguration for setup-required and pending states", async () => {
    const root = await freshRoot();
    const keychain = new FakeKeychain();
    const store = new ConnectionStore(join(root, "state-root"), keychain);
    await store.initialize();
    await expect(store.assertReconfigurationAvailable()).rejects.toBeInstanceOf(
      SetupRequiredError,
    );
    await atomicWriteJson(store.paths.connection, {
      schema_version: 2,
      base_url: "https://example.test/api/v1",
      key_ref: "keychain",
    });
    await atomicWriteJson(store.paths.connectionPending, {
      schema_version: 1,
      status: "pending",
    });
    await expect(store.assertReconfigurationAvailable()).rejects.toBeInstanceOf(
      RecoveryPendingError,
    );
  });

  it("stores setup credentials in the keychain and only a marker on disk", async () => {
    const root = await freshRoot();
    const keychain = new FakeKeychain();
    const store = new ConnectionStore(join(root, "state-root"), keychain);
    await store.save("https://example.test/api/v1", "bl_setup_secret");
    expect(await readFile(store.paths.connection, "utf8")).not.toContain(
      "bl_setup_secret",
    );
    await expect(
      keychain.get({
        service: KEYCHAIN_SERVICE,
        account: KEYCHAIN_API_ACCOUNT,
      }),
    ).resolves.toBe("bl_setup_secret");
  });

  it("exposes the Windows ACL seam without changing POSIX mode behavior", async () => {
    const calls: string[] = [];
    const security = windowsPathSecurity({
      applyCurrentUserAcl: (path, directory) => {
        calls.push(`apply:${path}:${directory}`);
      },
      verifyCurrentUserAcl: (path, directory) => {
        calls.push(`verify:${path}:${directory}`);
      },
    });
    await security.secure("C:\\state", true);
    await security.verify("C:\\state", true);
    expect(calls).toEqual(["apply:C:\\state:true", "verify:C:\\state:true"]);
    expect(posixPathSecurity()).toHaveProperty("verify");
  });
});
