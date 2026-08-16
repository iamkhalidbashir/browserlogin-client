import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runRunnerChild } from "../../src/core/runner/child.js";
import { createOneShotLaunchFile } from "../../src/core/runner/launch.js";
import { launchRunner } from "../../src/core/runner/supervisor.js";
import type { LaunchSpec } from "../../src/core/runner/types.js";

const baseSpec = {
  profile_id: "fake-profile",
  seed: 7,
  platform: "linux",
  geoip: false,
  humanize: false,
  human_preset: "default",
  bumblebee_profile: "default",
  headless: true,
  timezone: null,
  locale: null,
  user_agent: null,
  viewport: null,
  args: [],
  user_data_dir: "",
  browser_cache_dir: "",
  browser_cache_max_bytes: 1024,
  proxy: null,
} satisfies LaunchSpec;

class FakeContext {
  private readonly listeners = new Set<() => void>();
  private pageCount = 1;
  private closed = false;
  constructor(initialPages = 1) {
    this.pageCount = initialPages;
  }
  readonly fakeBrowser = {
    isConnected: () => !this.closed,
    on: (_event: "disconnected", listener: () => void) =>
      this.listeners.add(listener),
    off: (_event: "disconnected", listener: () => void) =>
      this.listeners.delete(listener),
  };
  pages = () => Array.from({ length: this.pageCount }, () => ({}));
  browser = () => this.fakeBrowser;
  on = (_event: "close", listener: () => void) => this.listeners.add(listener);
  off = (_event: "close", listener: () => void) =>
    this.listeners.delete(listener);
  close = async () => {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.listeners) listener();
  };
  disconnect = () => {
    for (const listener of this.listeners) listener();
  };
  setPages = (count: number) => {
    this.pageCount = count;
  };
}

const listenCdp = async (
  root: string,
): Promise<{ server: Server; port: number }> => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser/fake",
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("CDP server did not bind");
  await writeFile(
    join(root, "DevToolsActivePort"),
    `${address.port}\n/devtools/browser/fake\n`,
  );
  return { server, port: address.port };
};

describe("fake runner lifecycle", () => {
  test("does not launch the fake browser without exact authorization", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-runner-timeout-"));
    const paths = {
      launchFile: join(root, "launch"),
      gateFile: join(root, "gate"),
      controlFile: join(root, "control"),
      readyFile: join(root, "ready"),
    };
    const spec = { ...baseSpec, user_data_dir: root, browser_cache_dir: root };
    await createOneShotLaunchFile(paths.launchFile, spec);
    let launches = 0;
    await expect(
      runRunnerChild({
        paths,
        expectedProfileId: spec.profile_id,
        gateTimeoutMs: 20,
        sdk: {
          launchPersistentContext: async () => {
            launches += 1;
            throw new Error("must not launch");
          },
        },
      }),
    ).rejects.toThrow("timed out");
    expect(launches).toBe(0);
    await expect(stat(paths.launchFile)).rejects.toThrow();
  });

  test("publishes ready only after CDP and invokes normal stop once across close races", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-runner-fake-"));
    const paths = {
      launchFile: join(root, "launch"),
      gateFile: join(root, "gate"),
      controlFile: join(root, "control"),
      readyFile: join(root, "ready"),
    };
    const spec = { ...baseSpec, user_data_dir: root, browser_cache_dir: root };
    await createOneShotLaunchFile(paths.launchFile, spec);
    await writeFile(paths.gateFile, "authorized\n");
    const cdp = await listenCdp(root);
    const context = new FakeContext();
    let normalStops = 0;
    const running = runRunnerChild({
      paths,
      expectedProfileId: spec.profile_id,
      sdk: {
        launchPersistentContext: async (options) => {
          expect(options).not.toHaveProperty("bumblebee_profile");
          return context;
        },
      },
      normalStop: () => {
        normalStops += 1;
      },
      pollMs: 5,
    });
    for (
      let attempt = 0;
      attempt < 100 &&
      !(await readFile(paths.readyFile, "utf8").catch(() => undefined));
      attempt += 1
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    context.disconnect();
    await context.close();
    await running;
    await new Promise<void>((resolve, reject) =>
      cdp.server.close((error) => (error ? reject(error) : resolve())),
    );
    expect(normalStops).toBe(1);
  });

  test("supervisor sends authorized gate and clears inherited keyless license variables", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-supervisor-"));
    const paths = {
      launchFile: join(root, "launch"),
      gateFile: join(root, "gate"),
      controlFile: join(root, "control"),
      readyFile: join(root, "ready"),
    };
    const spec = { ...baseSpec, user_data_dir: root, browser_cache_dir: root };
    const identity = {
      pid: process.pid + 1,
      process_start_time: "fake",
      cmdline_hash: "fake",
    };
    let childEnv: NodeJS.ProcessEnv | undefined;
    let readyCallbacks = 0;
    let forcedIdentity: unknown;
    const oldKey = process.env.CLOAKBROWSER_LICENSE_KEY;
    const oldApi = process.env.CLOAKBROWSER_LICENSE_API;
    const oldBrowserLoginApi = process.env.BROWSERLOGIN_API_KEY;
    const oldCloakApi = process.env.CLOAKBROWSER_API_KEY;
    process.env.CLOAKBROWSER_LICENSE_KEY = "inherited-secret";
    process.env.CLOAKBROWSER_LICENSE_API = "http://inherited:1";
    process.env.BROWSERLOGIN_API_KEY = "inherited-api-secret";
    process.env.CLOAKBROWSER_API_KEY = "inherited-cloak-api-secret";
    try {
      const running = await launchRunner({
        spec,
        paths,
        binaryPath: "/tmp/fake-browser",
        cwd: root,
        logPath: join(root, "runner.log"),
        assertIdentity: async (actual) => actual,
        healthCallback: () => true,
        onReady: () => {
          readyCallbacks += 1;
        },
        isAlive: async () => true,
        cooperativeStopTimeoutMs: 10,
        stopTree: async (actual) => {
          forcedIdentity = actual;
          return true;
        },
        spawn: async (_argv, options) => {
          childEnv = options.env;
          void (async () => {
            for (let attempt = 0; attempt < 100; attempt += 1) {
              if (await readFile(paths.gateFile, "utf8").catch(() => undefined))
                break;
              await new Promise((resolve) => setTimeout(resolve, 2));
            }
            expect(await readFile(paths.gateFile, "utf8")).toBe("authorized\n");
            await writeFile(paths.readyFile, "browserlogin-runner-ready-v1\n");
          })();
          return { identity };
        },
      });
      expect(running.identity).toEqual(identity);
      expect(readyCallbacks).toBe(1);
      expect(childEnv?.CLOAKBROWSER_LICENSE_KEY).toBeUndefined();
      expect(childEnv?.CLOAKBROWSER_LICENSE_API).toBeUndefined();
      expect(childEnv?.BROWSERLOGIN_API_KEY).toBeUndefined();
      expect(childEnv?.CLOAKBROWSER_API_KEY).toBeUndefined();
      await running.stop();
      expect(forcedIdentity).toEqual(identity);
    } finally {
      if (oldKey === undefined) delete process.env.CLOAKBROWSER_LICENSE_KEY;
      else process.env.CLOAKBROWSER_LICENSE_KEY = oldKey;
      if (oldApi === undefined) delete process.env.CLOAKBROWSER_LICENSE_API;
      else process.env.CLOAKBROWSER_LICENSE_API = oldApi;
      if (oldBrowserLoginApi === undefined)
        delete process.env.BROWSERLOGIN_API_KEY;
      else process.env.BROWSERLOGIN_API_KEY = oldBrowserLoginApi;
      if (oldCloakApi === undefined) delete process.env.CLOAKBROWSER_API_KEY;
      else process.env.CLOAKBROWSER_API_KEY = oldCloakApi;
    }
  });

  test("treats zero pages at readiness as a normal stop", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "browserlogin-runner-zero-pages-"),
    );
    const paths = {
      launchFile: join(root, "launch"),
      gateFile: join(root, "gate"),
      controlFile: join(root, "control"),
      readyFile: join(root, "ready"),
    };
    const spec = { ...baseSpec, user_data_dir: root, browser_cache_dir: root };
    await createOneShotLaunchFile(paths.launchFile, spec);
    await writeFile(paths.gateFile, "authorized\n");
    const cdp = await listenCdp(root);
    const context = new FakeContext(0);
    let normalStops = 0;
    try {
      await runRunnerChild({
        paths,
        expectedProfileId: spec.profile_id,
        sdk: {
          launchPersistentContext: async () => context,
        },
        normalStop: () => {
          normalStops += 1;
        },
      });
      expect(normalStops).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        cdp.server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
