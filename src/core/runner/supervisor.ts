import { unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertIdentity, type ProcessIdentity } from "../processes/identity.js";
import { killProcessTree } from "../processes/tree.js";
import {
  createOneShotLaunchFile,
  protectedLaunchArgs,
  validateLaunchSpec,
} from "./launch.js";
import {
  waitForReady,
  writeAuthorization,
  writeStopControl,
} from "./protocol.js";
import type {
  ChildExit,
  RunnerSupervisorOptions,
  SpawnedRunner,
} from "./types.js";

const assertLicenseApi = (value: string): string => {
  if (
    [...value].some((character) => character.charCodeAt(0) > 0x7f) ||
    Buffer.byteLength(value, "ascii") > 24
  )
    throw new Error("license API URL must be at most 24 ASCII bytes");
  return value;
};

const defaultSpawn = async (
  argv: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<SpawnedRunner> => {
  const { spawn } = await import("node:child_process");
  const child = spawn(argv[0]!, [...argv.slice(1)], {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "ignore", "ignore"],
  });
  const completion = new Promise<ChildExit>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", () => resolve({ code: null, signal: null }));
  });
  let identity: ProcessIdentity;
  try {
    identity = await import("../processes/identity.js").then(
      ({ readIdentity }) =>
        new Promise<ProcessIdentity>((resolve, reject) => {
          const started = Date.now();
          const probe = async () => {
            const value = await readIdentity({
              pid: child.pid!,
              process_start_time: "unknown",
              cmdline_hash: "",
            });
            if (value) return resolve(value);
            if (Date.now() - started > 2_000)
              return reject(new Error("runner process identity unavailable"));
            setTimeout(() => void probe(), 20);
          };
          void probe();
        }),
    );
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
  return { identity, completion, sendSignal: (signal) => child.kill(signal) };
};

const cleanupArtifacts = async (
  paths: RunnerSupervisorOptions["paths"],
): Promise<void> => {
  await Promise.all(
    Object.values(paths).map((path) => unlink(path).catch(() => undefined)),
  );
};

export async function launchRunner(options: RunnerSupervisorOptions): Promise<{
  identity: ProcessIdentity;
  closed: Promise<ChildExit>;
  stop(): Promise<void>;
}> {
  const spec = validateLaunchSpec(options.spec);
  protectedLaunchArgs(spec);
  if (options.licenseApiUrl !== undefined)
    assertLicenseApi(options.licenseApiUrl);
  await createOneShotLaunchFile(
    options.paths.launchFile,
    spec,
    options.pathSecurity,
  );
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.BROWSERLOGIN_API_KEY;
  delete env.CLOAKBROWSER_API_KEY;
  delete env.CLOAKBROWSER_LICENSE_KEY;
  delete env.CLOAKBROWSER_LICENSE_API;
  Object.assign(env, {
    CLOAKBROWSER_BINARY_PATH: options.binaryPath,
    ...(options.licenseKey
      ? { CLOAKBROWSER_LICENSE_KEY: options.licenseKey }
      : {}),
    ...(options.licenseApiUrl
      ? { CLOAKBROWSER_LICENSE_API: options.licenseApiUrl }
      : {}),
  });
  const spawn = options.spawn ?? defaultSpawn;
  const argv = [
    process.env.BROWSERLOGIN_RUNNER_COMMAND ??
      (process.versions.bun
        ? process.execPath
        : (process.env.BROWSERLOGIN_BUN_PATH ?? "bun")),
    fileURLToPath(new URL("./child.ts", import.meta.url)),
    "--profile-id",
    spec.profile_id,
    "--launch-file",
    options.paths.launchFile,
    "--gate-file",
    options.paths.gateFile,
    "--control-file",
    options.paths.controlFile,
    "--ready-file",
    options.paths.readyFile,
  ];
  let runner: SpawnedRunner;
  try {
    runner = await spawn(argv, {
      cwd: options.cwd,
      env,
    });
  } catch (error) {
    await cleanupArtifacts(options.paths);
    throw error;
  }
  const assert = options.assertIdentity ?? assertIdentity;
  try {
    await assert(runner.identity);
    await writeAuthorization(options.paths.gateFile);
  } catch (error) {
    await stopRunner(runner.identity, options).catch(() => undefined);
    await cleanupArtifacts(options.paths);
    throw error;
  }
  try {
    await waitForReady(options.paths.readyFile, options.readyTimeoutMs);
    await assert(runner.identity);
    if (options.healthCallback && !(await options.healthCallback()))
      throw new Error("CloakBrowser runner health callback rejected readiness");
    await options.onReady?.();
  } catch (error) {
    await stopRunner(runner.identity, options).catch(() => undefined);
    await cleanupArtifacts(options.paths);
    throw error;
  }
  let normalStopCalled = false;
  const normalStop = async (): Promise<void> => {
    if (normalStopCalled) return;
    normalStopCalled = true;
    await options.onNormalStop?.();
  };
  const closed = runner.completion.then(async (exit) => {
    if (exit.code === 0 && exit.signal === null) await normalStop();
    return exit;
  });
  let stopping: Promise<void> | undefined;
  let completed = false;
  return {
    identity: runner.identity,
    closed,
    stop: async () => {
      if (completed) return;
      if (stopping) return stopping;
      stopping = (async () => {
        try {
          await assert(runner.identity);
          await writeStopControl(options.paths.controlFile);
          const grace = options.cooperativeStopTimeoutMs ?? 5_000;
          const deadline = Date.now() + grace;
          while (Date.now() < deadline) {
            const alive = options.isAlive
              ? await options.isAlive(runner.identity)
              : Boolean(
                  await import("../processes/identity.js").then(
                    ({ readIdentity }) => readIdentity(runner.identity),
                  ),
                );
            if (!alive) {
              completed = true;
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          if (!(await stopRunner(runner.identity, options)))
            throw new Error("CloakBrowser runner did not stop");
          completed = true;
        } catch (error) {
          await stopRunner(runner.identity, options).catch(() => undefined);
          throw error;
        } finally {
          stopping = undefined;
        }
      })();
      return stopping;
    },
  };
}

async function stopRunner(
  identity: ProcessIdentity,
  options: RunnerSupervisorOptions,
): Promise<boolean> {
  if (options.stopTree)
    return options.stopTree(identity, options.hardStopTimeoutMs ?? 10_000);
  else {
    await killProcessTree(identity.pid, {
      recordedIdentity: identity,
      graceMs: options.hardStopTimeoutMs ?? 10_000,
    });
    return true;
  }
}
