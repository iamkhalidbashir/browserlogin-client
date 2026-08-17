import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { runRunnerChild } from "../../src/core/runner/child.js";
import { createOneShotLaunchFile } from "../../src/core/runner/launch.js";
import { launchRunner } from "../../src/core/runner/supervisor.js";
import { readFileSync, chmodSync } from "node:fs";
import type { ChildExit, LaunchSpec } from "../../src/core/runner/types.js";

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

  test("unauthorized actual child times out and leaves no runner artifacts", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "browserlogin-runner-unauthorized-child-"),
    );
    const fakeBinary = fileURLToPath(
      new URL("../fixtures/fake-browser.js", import.meta.url),
    );
    const fakeSdk = fileURLToPath(
      new URL("../fixtures/fake-sdk.js", import.meta.url),
    );
    const argvFile = join(root, "fake-argv.json");
    const paths = {
      launchFile: join(root, "launch.json"),
      gateFile: join(root, "gate"),
      controlFile: join(root, "control"),
      readyFile: join(root, "ready"),
    };
    const spec = {
      ...baseSpec,
      user_data_dir: join(root, "profile"),
      browser_cache_dir: join(root, "cache"),
    };
    await createOneShotLaunchFile(paths.launchFile, spec);
    const command = process.versions.bun
      ? process.execPath
      : (process.env.BROWSERLOGIN_BUN_PATH ?? "bun");
    const child = spawn(
      command,
      [
        fileURLToPath(
          new URL("../../src/core/runner/child.ts", import.meta.url),
        ),
        "--profile-id",
        spec.profile_id,
        "--launch-file",
        paths.launchFile,
        "--gate-file",
        paths.gateFile,
        "--control-file",
        paths.controlFile,
        "--ready-file",
        paths.readyFile,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          BROWSERLOGIN_RUNNER_SDK_MODULE: fakeSdk,
          BROWSERLOGIN_FAKE_EXECUTABLE: fakeBinary,
          FAKE_BROWSER_ARGV_FILE: argvFile,
          BROWSERLOGIN_RUNNER_GATE_TIMEOUT_MS: "50",
        },
        stdio: "ignore",
      },
    );
    const exit = await Promise.race([
      new Promise<{ code: number | null; signal: string | null }>((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("unauthorized child did not exit")),
          2_000,
        ),
      ),
    ]);
    expect(exit.code).toBe(1);
    expect(() => readFileSync(argvFile, "utf8")).toThrow();
    for (const path of Object.values(paths))
      await expect(stat(path)).rejects.toThrow();
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
    const lifecycleEvents: string[] = [];
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
        assertIdentity: async (actual) => actual,
        healthCallback: () => true,
        onSpawned: async () => {
          lifecycleEvents.push("spawned");
          expect(
            await readFile(paths.gateFile, "utf8").catch(() => undefined),
          ).toBeUndefined();
        },
        onReady: () => {
          lifecycleEvents.push("ready");
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
          return { identity, completion: new Promise(() => undefined) };
        },
      });
      expect(running.identity).toEqual(identity);
      expect(readyCallbacks).toBe(1);
      expect(lifecycleEvents).toEqual(["spawned", "ready"]);
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

  test("explicit stop suppresses normal-stop for a clean child exit", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "browserlogin-supervisor-intentional-stop-"),
    );
    const paths = {
      launchFile: join(root, "launch"),
      gateFile: join(root, "gate"),
      controlFile: join(root, "control"),
      readyFile: join(root, "ready"),
    };
    const spec = { ...baseSpec, user_data_dir: root, browser_cache_dir: root };
    let complete!: (exit: ChildExit) => void;
    let normalStops = 0;
    const completion = new Promise<ChildExit>((resolve) => {
      complete = resolve;
    });
    const running = await launchRunner({
      spec,
      paths,
      binaryPath: "/tmp/fake-browser",
      cwd: root,
      assertIdentity: async (identity) => identity,
      isAlive: async () => false,
      onNormalStop: () => {
        normalStops += 1;
      },
      spawn: async () => {
        void (async () => {
          while (
            !(await readFile(paths.gateFile, "utf8").catch(() => undefined))
          )
            await new Promise((resolve) => setTimeout(resolve, 2));
          await writeFile(paths.readyFile, "browserlogin-runner-ready-v1\n");
        })();
        return {
          identity: {
            pid: process.pid + 1,
            process_start_time: "fake",
            cmdline_hash: "fake",
          },
          completion,
        };
      },
    });
    await running.stop();
    complete({ code: 0, signal: null });
    await running.closed;
    expect(normalStops).toBe(0);
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

  test.each(["context-close", "disconnect", "zero-pages"])(
    "runs the actual child through parent supervision for %s",
    async (lifecycle) => {
      const root = await mkdtemp(
        join(tmpdir(), "browserlogin-runner-real-child-"),
      );
      const fakeBinary = fileURLToPath(
        new URL("../fixtures/fake-browser.js", import.meta.url),
      );
      const fakeSdk = fileURLToPath(
        new URL("../fixtures/fake-sdk.js", import.meta.url),
      );
      if (process.platform !== "win32") chmodSync(fakeBinary, 0o700);
      const argvFile = join(root, "fake-argv.json");
      const exitFile = join(root, "fake-exit");
      const logFile = join(root, "fake-log.jsonl");
      const paths = {
        launchFile: join(root, "launch.json"),
        gateFile: join(root, "gate"),
        controlFile: join(root, "control"),
        readyFile: join(root, "ready"),
      };
      const spec = {
        ...baseSpec,
        seed: 424242,
        user_data_dir: join(root, "profile"),
        browser_cache_dir: join(root, "cache"),
      };
      let normalStops = 0;
      const oldArgv = process.env.FAKE_BROWSER_ARGV_FILE;
      const oldExit = process.env.FAKE_BROWSER_EXIT_FILE;
      const oldAfter = process.env.FAKE_BROWSER_EXIT_AFTER_MS;
      const oldLog = process.env.FAKE_BROWSER_LOG_FILE;
      const errorFile = join(root, "runner-error.txt");
      const oldErrorFile = process.env.BROWSERLOGIN_RUNNER_TEST_ERROR_FILE;
      const oldSdkModule = process.env.BROWSERLOGIN_RUNNER_SDK_MODULE;
      const oldExecutable = process.env.BROWSERLOGIN_FAKE_EXECUTABLE;
      const oldTestMode = process.env.BROWSERLOGIN_RUNNER_TEST_MODE;
      const oldExecutableArgs = process.env.BROWSERLOGIN_FAKE_EXECUTABLE_ARGS;
      process.env.FAKE_BROWSER_ARGV_FILE = argvFile;
      process.env.FAKE_BROWSER_EXIT_FILE = exitFile;
      process.env.FAKE_BROWSER_EXIT_AFTER_MS = "5000";
      process.env.FAKE_BROWSER_LOG_FILE = logFile;
      process.env.BROWSERLOGIN_RUNNER_SDK_MODULE = fakeSdk;
      process.env.BROWSERLOGIN_FAKE_EXECUTABLE =
        process.platform === "win32" ? "bun" : fakeBinary;
      process.env.BROWSERLOGIN_FAKE_EXECUTABLE_ARGS =
        process.platform === "win32" ? JSON.stringify([fakeBinary]) : "[]";
      process.env.BROWSERLOGIN_RUNNER_TEST_MODE = "1";
      const oldLifecycle = process.env.FAKE_SDK_LIFECYCLE;
      process.env.FAKE_SDK_LIFECYCLE = lifecycle;
      process.env.BROWSERLOGIN_RUNNER_TEST_ERROR_FILE = errorFile;
      try {
        const running = await launchRunner({
          spec,
          paths,
          binaryPath: fakeBinary,
          cwd: root,
          readyTimeoutMs: 5_000,
          onNormalStop: () => {
            normalStops += 1;
          },
        });
        const exit = await Promise.race([
          running.closed,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("fake child did not close")),
              5_000,
            ),
          ),
        ]);
        expect(exit).toEqual({ code: 0, signal: null });
        expect(normalStops).toBe(1);
        const observedArgv = JSON.parse(
          readFileSync(argvFile, "utf8"),
        ) as string[];
        expect(observedArgv).toContain("--fingerprint=424242");
        expect(observedArgv).not.toContain("--fingerprint=linux");
        expect(readFileSync(exitFile, "utf8")).toBe("0");
      } finally {
        if (oldArgv === undefined) delete process.env.FAKE_BROWSER_ARGV_FILE;
        else process.env.FAKE_BROWSER_ARGV_FILE = oldArgv;
        if (oldExit === undefined) delete process.env.FAKE_BROWSER_EXIT_FILE;
        else process.env.FAKE_BROWSER_EXIT_FILE = oldExit;
        if (oldAfter === undefined)
          delete process.env.FAKE_BROWSER_EXIT_AFTER_MS;
        else process.env.FAKE_BROWSER_EXIT_AFTER_MS = oldAfter;
        if (oldLog === undefined) delete process.env.FAKE_BROWSER_LOG_FILE;
        else process.env.FAKE_BROWSER_LOG_FILE = oldLog;
        if (oldErrorFile === undefined)
          delete process.env.BROWSERLOGIN_RUNNER_TEST_ERROR_FILE;
        else process.env.BROWSERLOGIN_RUNNER_TEST_ERROR_FILE = oldErrorFile;
        if (oldSdkModule === undefined)
          delete process.env.BROWSERLOGIN_RUNNER_SDK_MODULE;
        else process.env.BROWSERLOGIN_RUNNER_SDK_MODULE = oldSdkModule;
        if (oldExecutable === undefined)
          delete process.env.BROWSERLOGIN_FAKE_EXECUTABLE;
        else process.env.BROWSERLOGIN_FAKE_EXECUTABLE = oldExecutable;
        if (oldTestMode === undefined)
          delete process.env.BROWSERLOGIN_RUNNER_TEST_MODE;
        else process.env.BROWSERLOGIN_RUNNER_TEST_MODE = oldTestMode;
        if (oldExecutableArgs === undefined)
          delete process.env.BROWSERLOGIN_FAKE_EXECUTABLE_ARGS;
        else process.env.BROWSERLOGIN_FAKE_EXECUTABLE_ARGS = oldExecutableArgs;
        if (oldLifecycle === undefined) delete process.env.FAKE_SDK_LIFECYCLE;
        else process.env.FAKE_SDK_LIFECYCLE = oldLifecycle;
      }
    },
  );
});
