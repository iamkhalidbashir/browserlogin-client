import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runRunnerChild } from "../../src/core/runner/child.js";
import { createOneShotLaunchFile } from "../../src/core/runner/launch.js";
import { launchRunner } from "../../src/core/runner/supervisor.js";
import {
  RUNNER_CHILD_OUTCOME,
  type BrowserContextLike,
  type LaunchSpec,
} from "../../src/core/runner/types.js";

const connectToLoopbackProxy = async (proxyUrl: string): Promise<void> => {
  const url = new URL(proxyUrl);
  expect(url.protocol).toBe("socks5:");
  expect(url.hostname).toBe("127.0.0.1");
  expect(url.username).toBe("");
  expect(url.password).toBe("");
  const socket = connect({ host: url.hostname, port: Number(url.port) });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.destroy();
};

const listenCdp = async (root: string): Promise<Server> => {
  const server = createServer((_request, response) => {
    const address = server.address();
    if (!address || typeof address === "string") {
      response.statusCode = 503;
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        webSocketDebuggerUrl: `ws://127.0.0.1:${address.port}/devtools/browser/fake`,
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
  return server;
};

const context = (): BrowserContextLike => {
  const listeners = new Set<() => void>();
  let closed = false;
  return {
    pages: () => (closed ? [] : [{}]),
    browser: () => ({
      isConnected: () => !closed,
      on: (_event, listener) => listeners.add(listener),
      off: (_event, listener) => listeners.delete(listener),
    }),
    on: (_event, listener) => listeners.add(listener),
    off: (_event, listener) => listeners.delete(listener),
    close: async () => {
      if (closed) return;
      closed = true;
      for (const listener of listeners) listener();
    },
  };
};

const specFor = (root: string): LaunchSpec => ({
  profile_id: "relay-profile",
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
  user_data_dir: root,
  browser_cache_dir: root,
  browser_cache_max_bytes: 1024,
  proxy: {
    protocol: "socks5",
    host: "upstream.invalid",
    port: 1080,
    username: "test-user",
    password: "test-password",
  },
});

describe("runner authenticated SOCKS5 relay", () => {
  test("keeps the relay listening from browser launch through readiness", async () => {
    // Given: an authenticated SOCKS5 profile and a live fake browser CDP endpoint.
    const root = await mkdtemp(join(tmpdir(), "browserlogin-runner-relay-"));
    const paths = {
      launchFile: join(root, "launch"),
      gateFile: join(root, "gate"),
      controlFile: join(root, "control"),
      readyFile: join(root, "ready"),
    };
    const spec = specFor(root);
    await createOneShotLaunchFile(paths.launchFile, spec);
    await writeFile(paths.gateFile, "authorized\n");
    const cdp = await listenCdp(root);
    let launchProxy: string | undefined;
    try {
      // When: the runner launches CloakBrowser and publishes ready.
      const running = runRunnerChild({
        paths,
        expectedProfileId: spec.profile_id,
        sdk: {
          launchPersistentContext: async (options) => {
            if (typeof options.proxy !== "string")
              throw new Error("runner did not hand off a local proxy URL");
            launchProxy = options.proxy;
            await connectToLoopbackProxy(launchProxy);
            return context();
          },
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

      // Then: ready is observable only while that same local relay is listening.
      expect(await readFile(paths.readyFile, "utf8")).toContain('"version":1');
      if (!launchProxy) throw new Error("runner did not launch the browser");
      await connectToLoopbackProxy(launchProxy);
      await writeFile(paths.controlFile, "stop\n");
      await expect(running).resolves.toBe(RUNNER_CHILD_OUTCOME.CONTROL_STOP);
      await expect(connectToLoopbackProxy(launchProxy)).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve, reject) =>
        cdp.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  test("surfaces only allowlisted relay phases when the runner exits before ready", async () => {
    // Given: a runner whose stderr mixes a safe relay phase with credential material.
    const root = await mkdtemp(join(tmpdir(), "browserlogin-runner-diagnostic-"));
    const paths = {
      launchFile: join(root, "launch"),
      gateFile: join(root, "gate"),
      controlFile: join(root, "control"),
      readyFile: join(root, "ready"),
    };

    // When: readiness fails after the child has already exited.
    const launch = launchRunner({
      spec: { ...specFor(root), proxy: null },
      paths,
      binaryPath: "/tmp/fake-browser",
      cwd: root,
      readyTimeoutMs: 20,
      assertIdentity: async (identity) => identity,
      stopTree: async () => true,
      spawn: async () => ({
        identity: {
          pid: process.pid + 1,
          process_start_time: "fake",
          cmdline_hash: "fake",
        },
        completion: Promise.resolve({ code: 1, signal: null }),
        stderr: () =>
          "proxy-password=must-not-escape\n[socks-relay] phase=upstream-authentication\n",
      }),
    });

    // Then: the diagnostic identifies only the failed relay phase.
    await expect(launch).rejects.toThrow(
      "CloakBrowser runner exited before ready: [socks-relay] phase=upstream-authentication",
    );
    await expect(launch).rejects.not.toThrow("must-not-escape");
  });
});
