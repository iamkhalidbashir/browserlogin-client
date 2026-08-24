import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { runCli, type CliIO } from "../../src/cli/index.js";
import {
  ApplicationOperationError,
  createApplicationRuntime,
  unwrapApplicationResult,
} from "../../src/core/app/index.js";
import { ConnectionStore } from "../../src/core/config/connection.js";
import { RecoveryStateSchema } from "../../src/core/coordinator/state.js";
import { KeychainFacade } from "../../src/core/keychain/index.js";
import { ProfileSchema, SessionSchema } from "../../src/shared/api-types.js";
import { createRPCHandlers } from "../../src/bun/rpc.js";
import { createRegistry } from "../../src/mcp/registry.js";
import { profileLaunchSpec } from "../../src/core/app/profile-launch.js";
import { routeProxy } from "../../src/core/proxy/routing.js";
import { AppRPCSchemas } from "../../src/shared/rpc-schema.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("application adapter parity", () => {
  test("routes GUI and CLI authenticated SOCKS starts through the same relay configuration", async () => {
    // Given: one shared application service and an authenticated SOCKS profile.
    const calls: Array<{ readonly profileId: string }> = [];
    const services = {
      sessionsStart: async (raw: unknown) => {
        const input = AppRPCSchemas.sessionsStart.params.parse(raw);
        calls.push(input);
        return { status: "running" };
      },
    };
    const rpc = createRPCHandlers({ services });
    const output: string[] = [];
    const profile = ProfileSchema.parse({
      id: "socks-profile",
      name: "SOCKS profile",
      seed: 7,
      proxy: {
        id: "proxy-1",
        name: "SOCKS",
        protocol: "socks5",
        host: "127.0.0.1",
        port: 1080,
        username: "test-user",
        password: "test-password",
      },
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
      cloud: {},
    });
    const launchProxy = profileLaunchSpec(profile).proxy;
    if (!launchProxy) throw new Error("SOCKS launch proxy is required");

    // When: the GUI RPC adapter and CLI adapter start that profile.
    await rpc.sessionsStart({ profileId: profile.id });
    await runCli(["start", profile.id], {
      services,
      io: {
        stdout: (value) => output.push(value),
        stderr: (value) => output.push(value),
        prompt: async () => "",
      },
    });

    // Then: both adapters preserve the same profile ID and shared relay route.
    expect(calls).toEqual([
      { profileId: "socks-profile" },
      { profileId: "socks-profile" },
    ]);
    expect(
      routeProxy({
        ...launchProxy,
        username: launchProxy.username ?? undefined,
        password: launchProxy.password ?? undefined,
      }),
    ).toEqual({
      mode: "relay",
      launchProxy: null,
      upstream: {
        protocol: "socks5",
        host: "127.0.0.1",
        port: 1080,
        username: "test-user",
        password: "test-password",
      },
    });
    expect(output).toEqual(["Profile started: socks-profile\n"]);
  });

  test("preserves MCP initialization-required presentation after result conversion", async () => {
    const registry = await createRegistry({
      lifecycle: {
        start: async () => {
          throw new ApplicationOperationError(
            "BROWSER_INIT_REQUIRED",
            "CloakBrowser is not initialized. Call browser_init, then retry browser_session_start.",
            false,
          );
        },
        stop: async () => undefined,
        forceStop: async () => undefined,
      },
      browserRouter: { call: async () => ({ content: [] }) },
      browserTools: [],
    });

    await expect(
      registry.call("browser_session_start", { profile_id: "profile-1" }),
    ).resolves.toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "CloakBrowser is not initialized. Call browser_init, then retry browser_session_start.",
        },
      ],
    });
  });

  test("routes lifecycle starts through the same application coordinator", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-app-parity-"));
    roots.push(root);
    const keychain = new KeychainFacade({
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
    });
    const start = vi.fn(async (profileId: string) =>
      RecoveryStateSchema.parse({
        version: 1,
        profile_id: profileId,
        run_id: "0123456789abcdef0123456789abcdef",
        start_key: "start-key",
        stop_key: null,
        remote_session_id: "session-1",
        archive: null,
        archive_artifact: null,
        work_dir: join(root, "work"),
        cache_dir: join(root, "cache"),
        launch_file: null,
        runner_pid: 42,
        runner_start_time: "1000",
        runner_cmdline_hash: "a".repeat(64),
        license_acquired: false,
        archive_materialized: true,
        browser_launched: true,
        relay_cdp_url: "ws://127.0.0.1:43123/",
        uploaded_storage_id: null,
        stop_payload: null,
        retry_count: 0,
        retry_after: null,
        updated_at: "2026-08-22T00:00:00.000Z",
        status: "running",
      }),
    );
    const stopped = SessionSchema.parse({
      id: "session-1",
      profile_id: "profile-1",
      generation: 1,
      state: "stopped",
    });
    const application = createApplicationRuntime({
      root,
      connection: new ConnectionStore(root, keychain),
      keychain,
      coordinator: {
        start,
        stop: async () => stopped,
        forceStop: async () => stopped,
        recover: async () => null,
      },
    });
    const rpc = createRPCHandlers({ services: application.services });
    const output: string[] = [];
    const io: CliIO = {
      stdout: (value) => output.push(value),
      stderr: (value) => output.push(value),
      prompt: async () => "",
    };
    const registry = await createRegistry({
      lifecycle: {
        start: async (profileId) =>
          unwrapApplicationResult(await application.lifecycle.start(profileId)),
        stop: async (profileId) =>
          unwrapApplicationResult(await application.lifecycle.stop(profileId)),
        forceStop: async (profileId) =>
          unwrapApplicationResult(
            await application.lifecycle.forceStop(profileId),
          ),
      },
      browserRouter: { call: async () => ({ content: [] }) },
      browserTools: [],
    });

    await application.services.sessionsStart?.({ profileId: "profile-1" });
    await expect(
      rpc.sessionsStart({ profileId: "profile-1" }),
    ).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      runCli(["start", "profile-1"], { services: application.services, io }),
    ).resolves.toBe(0);
    await expect(
      registry.call("browser_session_start", { profile_id: "profile-1" }),
    ).resolves.not.toMatchObject({ isError: true });

    expect(start).toHaveBeenCalledTimes(4);
    expect(output).toEqual(["Profile started: profile-1\n"]);
  });
});
