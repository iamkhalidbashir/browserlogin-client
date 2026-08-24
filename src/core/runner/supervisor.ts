import { unlink } from "node:fs/promises";
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
import { RUNNER_NORMAL_CLOSE_EXIT_CODE } from "./types.js";
import {
  runnerEntrypoint,
  runnerExitedBeforeReady,
  spawnRunnerProcess,
} from "./process.js";

const assertLicenseApi = (value: string): string => {
  if (
    [...value].some((character) => character.charCodeAt(0) > 0x7f) ||
    Buffer.byteLength(value, "ascii") > 24
  )
    throw new Error("license API URL must be at most 24 ASCII bytes");
  return value;
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
  relayCdpUrl: string;
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
  const testMode = process.env.BROWSERLOGIN_RUNNER_TEST_MODE === "1";
  if (!testMode) {
    delete env.BROWSERLOGIN_RUNNER_SDK_MODULE;
    delete env.BROWSERLOGIN_RUNNER_TEST_ERROR_FILE;
    delete env.BROWSERLOGIN_RUNNER_TEST_MODE;
  }
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
  const spawn = options.spawn ?? spawnRunnerProcess;
  const argv = [
    process.env.BROWSERLOGIN_RUNNER_COMMAND ??
      (process.versions.bun
        ? process.execPath
        : (process.env.BROWSERLOGIN_BUN_PATH ?? "bun")),
    runnerEntrypoint(),
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
    options.timing?.mark("runner-spawn");
  } catch (error) {
    await cleanupArtifacts(options.paths);
    throw error;
  }
  const assert = options.assertIdentity ?? assertIdentity;
  let relayCdpUrl: string | undefined;
  try {
    await assert(runner.identity);
    await options.onSpawned?.(runner.identity);
    await writeAuthorization(options.paths.gateFile);
  } catch (error) {
    await stopRunner(runner.identity, options).catch(() => undefined);
    await cleanupArtifacts(options.paths);
    const exit = await Promise.race([
      runner.completion,
      new Promise<undefined>((resolve) => setTimeout(resolve, 100)),
    ]);
    if (exit)
      throw new Error(runnerExitedBeforeReady(runner.stderr?.()).message, {
        cause: error,
      });
    throw error;
  }
  try {
    const ready = await Promise.race([
      waitForReady(options.paths.readyFile, options.readyTimeoutMs),
      runner.completion.then(() => {
        throw runnerExitedBeforeReady(runner.stderr?.());
      }),
    ]);
    await assert(runner.identity);
    if (options.healthCallback && !(await options.healthCallback()))
      throw new Error("CloakBrowser runner health callback rejected readiness");
    await options.onReady?.(ready);
    relayCdpUrl = ready.relayCdpUrl;
  } catch (error) {
    await stopRunner(runner.identity, options).catch(() => undefined);
    await cleanupArtifacts(options.paths);
    throw error;
  }
  if (!relayCdpUrl) throw new Error("runner relay URL is unavailable");
  let normalStopCalled = false;
  let intentionalStop = false;
  const normalStop = async (): Promise<void> => {
    if (normalStopCalled) return;
    normalStopCalled = true;
    await options.onNormalStop?.();
  };
  const closed = runner.completion.then(async (exit) => {
    if (
      !intentionalStop &&
      exit.code === RUNNER_NORMAL_CLOSE_EXIT_CODE &&
      exit.signal === null
    )
      await normalStop();
    return exit;
  });
  let stopping: Promise<void> | undefined;
  let completed = false;
  return {
    identity: runner.identity,
    relayCdpUrl,
    closed,
    stop: async () => {
      if (completed) return;
      if (stopping) return stopping;
      stopping = (async () => {
        try {
          intentionalStop = true;
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
