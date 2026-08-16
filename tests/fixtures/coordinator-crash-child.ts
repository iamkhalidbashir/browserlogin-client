import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import {
  LifecycleCoordinator,
  type CoordinatorApi,
  type CrashPoint,
} from "../../src/core/coordinator/index.js";
import {
  readIdentity,
  type ProcessIdentity,
} from "../../src/core/processes/index.js";
import type { CoordinatorProfile } from "../../src/core/coordinator/coordinator.js";

const root = process.env.COORDINATOR_ROOT!;
const port = process.env.COORDINATOR_PORT!;
const point = process.env.COORDINATOR_POINT as CrashPoint | undefined;
const recovering = process.env.COORDINATOR_RECOVER === "1";
const stopping = process.env.COORDINATOR_STOP === "1";
const forcing = process.env.COORDINATOR_FORCE === "1";
const profileId = "profile-1";

const profile = {
  id: profileId,
  name: "crash-test",
  seed: 1,
  platform: "macos",
  geoip: true,
  humanize: true,
  human_preset: "careful",
  bumblebee_profile: "natural",
  headless: true,
  timezone: null,
  locale: null,
  user_agent: null,
  viewport: null,
  args: [],
  proxy: null,
  cloud: {},
} as CoordinatorProfile["profile"];
const launchSpec = {
  profile_id: profileId,
  seed: 1,
  platform: "macos" as const,
  geoip: true,
  humanize: true,
  human_preset: "careful" as const,
  bumblebee_profile: "natural" as const,
  headless: true,
  timezone: null,
  locale: null,
  user_agent: null,
  viewport: null,
  args: [],
  proxy: null,
};

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
  if (!response.ok) throw new Error(`mock API returned ${response.status}`);
  return (await response.json()) as T;
}

async function runnerIdentity(pid: number): Promise<ProcessIdentity> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const identity = await readIdentity({
      pid,
      process_start_time: "unknown",
      cmdline_hash: "",
    });
    if (identity) return identity;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("fake runner identity unavailable");
}

const api: CoordinatorApi = {
  async startSession(profileId, idempotencyKey) {
    return json("/sessions/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ profile_id: profileId }),
    });
  },
  async downloadArchive() {
    throw new Error("crash fixture does not seed a remote archive");
  },
  async requestUploadUrl() {
    return json("/archive-upload-url", { method: "POST" });
  },
  async directUpload(_grant, path, options) {
    const bytes = await readFile(path);
    if (bytes.byteLength !== options.expectedSize)
      throw new Error("fixture upload size mismatch");
    const result = await json<{ storage_id: string }>("/upload", {
      method: "PUT",
      body: bytes,
    });
    return result.storage_id;
  },
  async stopSession(sessionId, archive, key) {
    return json("/sessions/stop", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ session_id: sessionId, archive }),
    });
  },
  async forceStopSession(sessionId, key) {
    return json("/sessions/force", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ session_id: sessionId, force: true }),
    });
  },
  async sessionStatus(sessionId) {
    return json(`/sessions/status?session_id=${encodeURIComponent(sessionId)}`);
  },
};

async function main(): Promise<void> {
  const coordinator = new LifecycleCoordinator({
    root,
    api,
    profile: async () => ({
      profile,
      launchSpec,
      binary: { path: process.execPath, source: "custom" } as never,
    }),
    license: {
      key: "test-license",
      acquire: async () => `http://license:4290`,
      release: async () => {
        await Bun.write(`${root}/release-${process.pid}`, "released\n");
      },
    },
    crashInjector: async (name) => {
      if (name === point) {
        await Bun.write(`${root}/crash-${name}`, `${process.pid}\n`);
        process.kill(process.pid, "SIGKILL");
      }
    },
    runner: async (options) => {
      const child = spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 100000)"],
        { stdio: "ignore" },
      );
      const identity = await runnerIdentity(child.pid!);
      await options.onSpawned?.(identity);
      return {
        identity,
        closed: new Promise(() => undefined),
        stop: async () => {
          try {
            process.kill(identity.pid, "SIGTERM");
          } catch (error) {
            void error;
          }
        },
      };
    },
  });

  if (recovering) {
    const state = await coordinator.recover(profileId);
    if (state?.status === "running") await coordinator.stop(profileId);
    if (
      state &&
      [
        "start-intent",
        "license",
        "remote-active",
        "archive_materialized",
        "spawn-intent",
        "archive-ready",
        "upload-pending",
        "force-stop",
      ].includes(state.status)
    )
      throw new Error(`recover left actionable state: ${state.status}`);
  } else {
    await coordinator.start(profileId);
    if (forcing) await coordinator.forceStop(profileId);
    else if (stopping) await coordinator.stop(profileId);
  }
}

await main();
