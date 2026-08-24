import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readIdentity, type ProcessIdentity } from "../processes/identity.js";
import type { SpawnedRunner } from "./types.js";
import { LAUNCH_TIMING_STAGES } from "../launch-timing.js";

const SOCKS_RELAY_DIAGNOSTIC =
  /^\[socks-relay] phase=(?:client-greeting|client-request|upstream-connect|upstream-method|upstream-authentication|upstream-request|tunnel)(?: detail=(?:no-bytes|early-disconnect bytes=\d+|timeout bytes=\d+|version=\d+|methods=[0-9a-f]*))?$/;
const LAUNCH_TIMING_DIAGNOSTIC = new RegExp(
  `^\\[launch-timing] stage=(?:${LAUNCH_TIMING_STAGES.join("|")}) delta_ms=\\d+ total_ms=\\d+$`,
);

export const safeRunnerDiagnostic = (line: string): boolean =>
  SOCKS_RELAY_DIAGNOSTIC.test(line) || LAUNCH_TIMING_DIAGNOSTIC.test(line);

export const runnerEntrypoint = (moduleUrl = import.meta.url): string =>
  fileURLToPath(
    moduleUrl.endsWith(".ts")
      ? new URL("./child.ts", moduleUrl)
      : new URL("../runner/child.js", moduleUrl),
  );

export const runnerExitedBeforeReady = (stderr: string | undefined): Error => {
  const diagnostic = (stderr ?? "")
    .split(/\r?\n/)
    .filter((line) => SOCKS_RELAY_DIAGNOSTIC.test(line))
    .join("\n");
  return new Error(
    diagnostic
      ? `CloakBrowser runner exited before ready: ${diagnostic}`
      : "CloakBrowser runner exited before ready",
  );
};

export const spawnRunnerProcess = async (
  argv: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<SpawnedRunner> => {
  const command = argv[0];
  if (!command) throw new Error("runner command is unavailable");
  const child = spawn(command, [...argv.slice(1)], {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "ignore", "pipe"],
  });
  const pid = child.pid;
  if (pid === undefined) throw new Error("runner process did not start");
  let stderr = "";
  let diagnosticBuffer = "";
  child.stderr?.on("data", (chunk: Buffer | string) => {
    const text = chunk.toString();
    stderr = `${stderr}${text}`.slice(-4_096);
    const lines = `${diagnosticBuffer}${text}`.split(/\r?\n/);
    diagnosticBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (safeRunnerDiagnostic(line)) process.stderr.write(`${line}\n`);
    }
  });
  const completion = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", () => resolve({ code: null, signal: null }));
  });
  let identity: ProcessIdentity;
  try {
    identity = await new Promise<ProcessIdentity>((resolve, reject) => {
      const started = Date.now();
      const probe = async () => {
        const value = await readIdentity({
          pid,
          process_start_time: "unknown",
          cmdline_hash: "",
        });
        if (value) return resolve(value);
        if (Date.now() - started > 2_000)
          return reject(new Error("runner process identity unavailable"));
        setTimeout(() => void probe(), 20);
      };
      void probe();
    });
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
  return {
    identity,
    completion,
    sendSignal: (signal) => child.kill(signal),
    stderr: () => stderr,
  };
};
