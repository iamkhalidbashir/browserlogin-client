import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRecoveryStore } from "../../src/core/coordinator/state.js";
import { readIdentity } from "../../src/core/processes/index.js";

const points = [
  "after-start-intent-save",
  "after-license-save",
  "after-remote-active-save",
  "after-archive-materialized-save",
  "after-spawn-identity-save-before-ready",
  "after-running-save",
  "after-archive-ready-save",
  "after-upload-pending-save-before-stop",
  "after-force-stop-intent-save",
  "after-runner-stopped-before-identity-save",
  "after-license-released-before-state-save",
  "after-stop-response-before-adopt",
] as const;
const profile = {
  id: "profile-1",
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
};

type Counters = {
  starts: number;
  uploads: number;
  stops: number;
  stopKeys: string[];
  forces: number;
  forceKeys: string[];
  uploadBytes: number;
  stopArchives: unknown[];
  remoteStopped: boolean;
};
let roots: string[] = [];
let servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
  servers = [];
  roots = [];
});

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let value = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      value += chunk;
    });
    request.on("end", () => resolve(value));
  });
}
function send(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function startMock(): Promise<{ port: number; counters: Counters }> {
  const counters: Counters = {
    starts: 0,
    uploads: 0,
    stops: 0,
    stopKeys: [],
    forces: 0,
    forceKeys: [],
    uploadBytes: 0,
    stopArchives: [],
    remoteStopped: false,
  };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const raw = await body(request);
    if (path === "/sessions/start") {
      counters.starts += 1;
      send(response, {
        session: {
          id: "session-1",
          profile_id: "profile-1",
          generation: 1,
          state: "active",
        },
        profile,
        archive: null,
      });
    } else if (path === "/sessions/status") {
      send(
        response,
        counters.remoteStopped
          ? {
              id: "session-1",
              profile_id: "profile-1",
              generation: 1,
              state: "stopped",
              status: "stopped",
              archive_generation: 1,
            }
          : {
              id: "session-1",
              profile_id: "profile-1",
              generation: 1,
              state: "active",
              status: "active",
            },
      );
    } else if (path === "/archive-upload-url") {
      send(response, {
        upload_url: `http://127.0.0.1:${(server.address() as { port: number }).port}/upload`,
        session_id: "session-1",
        expires_at: "2099-01-01T00:00:00.000Z",
      });
    } else if (path === "/upload") {
      counters.uploads += 1;
      counters.uploadBytes = Number(request.headers["content-length"] ?? 0);
      send(response, { storage_id: "storage-1" });
    } else if (path === "/sessions/stop") {
      counters.stops += 1;
      counters.stopArchives.push(JSON.parse(raw).archive);
      counters.remoteStopped = true;
      const key = request.headers["idempotency-key"];
      counters.stopKeys.push(Array.isArray(key) ? (key[0] ?? "") : (key ?? ""));
      send(response, {
        id: "session-1",
        profile_id: "profile-1",
        generation: 1,
        state: "stopped",
        status: "stopped",
        archive_generation: 1,
      });
    } else if (path === "/sessions/force") {
      counters.forces += 1;
      const key = request.headers["idempotency-key"];
      counters.forceKeys.push(
        Array.isArray(key) ? (key[0] ?? "") : (key ?? ""),
      );
      send(response, {
        id: "session-1",
        profile_id: "profile-1",
        generation: 1,
        state: "stopped",
        status: "stopped",
      });
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  return { port: (server.address() as { port: number }).port, counters };
}

async function runChild(
  root: string,
  port: number,
  point: string,
  recover: boolean,
): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}> {
  const fixture = fileURLToPath(
    new URL("../fixtures/coordinator-crash-child.ts", import.meta.url),
  );
  return new Promise((resolve, reject) => {
    const bun = process.env.BROWSERLOGIN_BUN_PATH ?? "bun";
    const child = spawn(bun, [fixture], {
      cwd: dirname(dirname(fixture)),
      env: {
        ...process.env,
        COORDINATOR_ROOT: root,
        COORDINATOR_PORT: String(port),
        COORDINATOR_POINT: recover ? "" : point,
        COORDINATOR_RECOVER: recover ? "1" : "0",
        COORDINATOR_STOP:
          !recover &&
          (point === "after-archive-ready-save" ||
            point === "after-upload-pending-save-before-stop" ||
            point === "after-runner-stopped-before-identity-save" ||
            point === "after-license-released-before-state-save" ||
            point === "after-stop-response-before-adopt")
            ? "1"
            : "0",
        COORDINATOR_FORCE:
          !recover && point === "after-force-stop-intent-save" ? "1" : "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`crash fixture timeout: ${stderr}`));
    }, 15_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stderr });
    });
  });
}

function expectForcedCrash(
  result: Awaited<ReturnType<typeof runChild>>,
  label?: string,
): void {
  if (process.platform === "win32")
    expect(result.code, label ?? JSON.stringify(result)).not.toBe(0);
  else expect(result.signal, label ?? JSON.stringify(result)).toBe("SIGKILL");
}

describe("Task 18 fresh-process SIGKILL recovery", () => {
  it("recovers every named durable cut point without duplicate session, upload, or commit", async () => {
    for (const point of points) {
      const root = await mkdtemp(join(tmpdir(), "browserlogin-crash-matrix-"));
      roots.push(root);
      const mock = await startMock();
      const crashed = await runChild(root, mock.port, point, false);
      expectForcedCrash(crashed, `${point}: ${JSON.stringify(crashed)}`);
      expect(await readFile(join(root, `crash-${point}`), "utf8")).toMatch(
        /\d+\n/,
      );
      const crashedState = await createRecoveryStore(root).load("profile-1");
      const runnerIdentity =
        crashedState?.runner_pid &&
        crashedState.runner_start_time &&
        crashedState.runner_cmdline_hash
          ? {
              pid: crashedState.runner_pid,
              process_start_time: crashedState.runner_start_time,
              cmdline_hash: crashedState.runner_cmdline_hash,
            }
          : undefined;
      if (runnerIdentity) {
        const runnerStoppedBeforeCrash =
          process.platform === "win32" ||
          point === "after-runner-stopped-before-identity-save" ||
          point === "after-license-released-before-state-save";
        expect(await readIdentity(runnerIdentity), point)[
          runnerStoppedBeforeCrash ? "toBeUndefined" : "toBeDefined"
        ]();
      }
      const recovered = await runChild(root, mock.port, point, true);
      expect(recovered.code, point).toBe(0);
      expect(mock.counters.starts, point).toBe(1);
      if (point === "after-force-stop-intent-save") {
        expect(mock.counters.stops, point).toBe(0);
        expect(mock.counters.forces, point).toBe(1);
        expect(new Set(mock.counters.forceKeys).size, point).toBe(1);
        expect(mock.counters.uploads, point).toBe(0);
      } else {
        expect(mock.counters.stops, point).toBe(1);
        expect(new Set(mock.counters.stopKeys).size, point).toBe(1);
        expect(mock.counters.uploads, point).toBe(1);
        expect(mock.counters.uploadBytes, point).toBeGreaterThan(0);
        expect(mock.counters.stopArchives, point).toHaveLength(1);
        expect(
          (await readdir(root)).filter((name) => name.startsWith("adopt-")),
          point,
        ).toHaveLength(1);
      }
      const state = await createRecoveryStore(root).load("profile-1");
      expect(state, point).toBeNull();
      if (runnerIdentity)
        expect(await readIdentity(runnerIdentity), point).toBeUndefined();
      const releases = (await readdir(root)).filter((name) =>
        name.startsWith("release-"),
      );
      expect(releases.length, point).toBe(
        point === "after-license-released-before-state-save" ? 2 : 1,
      );
    }
  }, 180_000);

  it("reconciles a persisted running state whose runner died before recovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-dead-runner-"));
    roots.push(root);
    const mock = await startMock();
    const crashed = await runChild(
      root,
      mock.port,
      "after-running-save",
      false,
    );
    expectForcedCrash(crashed);
    const state = await createRecoveryStore(root).load("profile-1");
    expect(state?.runner_pid).toBeTypeOf("number");
    try {
      process.kill(state!.runner_pid!, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    const recovered = await runChild(
      root,
      mock.port,
      "after-running-save",
      true,
    );
    expect(recovered.code).toBe(0);
    expect(mock.counters.starts).toBe(1);
    expect(mock.counters.uploads).toBe(1);
    expect(mock.counters.stops).toBe(1);
    expect(await createRecoveryStore(root).load("profile-1")).toBeNull();
  }, 30_000);

  it("cleans locally when the remote session was already stopped", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-remote-stopped-"));
    roots.push(root);
    const mock = await startMock();
    const crashed = await runChild(
      root,
      mock.port,
      "after-running-save",
      false,
    );
    expectForcedCrash(crashed);
    mock.counters.remoteStopped = true;
    const recovered = await runChild(
      root,
      mock.port,
      "after-running-save",
      true,
    );
    expect(recovered.code).toBe(0);
    expect(mock.counters.starts).toBe(1);
    expect(mock.counters.uploads).toBe(0);
    expect(mock.counters.stops).toBe(0);
    expect(mock.counters.forces).toBe(0);
    expect(await createRecoveryStore(root).load("profile-1")).toBeNull();
  }, 30_000);
});
