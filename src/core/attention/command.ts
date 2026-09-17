import type { AttentionOutcome } from "./types.js";

export const ATTENTION_COMMAND_TIMEOUT_MS = 5_000;
export const ATTENTION_OUTPUT_LIMIT_BYTES = 4_096;
const FORCE_KILL_GRACE_MS = 100;

export type AttentionCommand = {
  readonly executable: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
};

export type AttentionCommandResult =
  | {
      readonly status: "completed";
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
    }
  | { readonly status: "unavailable"; readonly reason: "executable_missing" }
  | { readonly status: "failed"; readonly reason: "launch_failed" }
  | { readonly status: "timed_out" }
  | { readonly status: "cancelled" };

export type AttentionCommandOptions = {
  readonly signal?: AbortSignal;
};

export type AttentionCommandRunner = (
  command: AttentionCommand,
  options?: AttentionCommandOptions,
) => Promise<AttentionCommandResult>;

export type AttentionSpawnRequest = {
  readonly cmd: readonly string[];
  readonly stdin: "ignore";
  readonly stdout: "pipe";
  readonly stderr: "pipe";
  readonly maxBuffer: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
};

export type AttentionSubprocess = {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<number>;
  readonly kill: (signal: NodeJS.Signals) => void;
};

export type AttentionSpawn = (
  request: AttentionSpawnRequest,
) => AttentionSubprocess;

type OutputRead =
  | { readonly status: "read"; readonly value: string }
  | { readonly status: "failed" };

type ProcessSettlement =
  | { readonly status: "exited"; readonly exitCode: number }
  | { readonly status: "spawn_failed"; readonly error: unknown }
  | { readonly status: "timed_out" }
  | { readonly status: "cancelled" };

const bunSpawn: AttentionSpawn = (request) => {
  const subprocess = Bun.spawn({
    cmd: [...request.cmd],
    stdin: request.stdin,
    stdout: request.stdout,
    stderr: request.stderr,
    maxBuffer: request.maxBuffer,
    ...(request.env ? { env: { ...request.env } } : {}),
  });
  return {
    stdout: subprocess.stdout,
    stderr: subprocess.stderr,
    exited: subprocess.exited,
    kill: (signal) => subprocess.kill(signal),
  };
};

export function createCommandRunner(
  spawn: AttentionSpawn = bunSpawn,
): AttentionCommandRunner {
  return async (command, options = {}) => {
    if (options.signal?.aborted) return { status: "cancelled" };

    let subprocess: AttentionSubprocess;
    try {
      subprocess = spawn({
        cmd: [command.executable, ...command.args],
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        maxBuffer: ATTENTION_OUTPUT_LIMIT_BYTES,
        ...(command.env ? { env: command.env } : {}),
      });
    } catch (error) {
      return isExecutableMissing(error)
        ? { status: "unavailable", reason: "executable_missing" }
        : { status: "failed", reason: "launch_failed" };
    }

    const stdout = readOutput(subprocess.stdout);
    const stderr = readOutput(subprocess.stderr);
    const exited: Promise<ProcessSettlement> = subprocess.exited.then(
      (exitCode) => ({ status: "exited", exitCode }),
      (error: unknown) => ({ status: "spawn_failed", error }),
    );
    let interrupt: ((result: ProcessSettlement) => void) | undefined;
    let interrupted = false;
    const interruption = new Promise<ProcessSettlement>((resolve) => {
      interrupt = resolve;
    });
    const stop = (result: ProcessSettlement): void => {
      if (interrupted) return;
      interrupted = true;
      subprocess.kill("SIGTERM");
      const forceTimer = setTimeout(
        () => subprocess.kill("SIGKILL"),
        FORCE_KILL_GRACE_MS,
      );
      void subprocess.exited.then(
        () => clearTimeout(forceTimer),
        () => clearTimeout(forceTimer),
      );
      interrupt?.(result);
    };
    const timer = setTimeout(
      () => stop({ status: "timed_out" }),
      ATTENTION_COMMAND_TIMEOUT_MS,
    );
    const onAbort = () => stop({ status: "cancelled" });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    const settlement = await Promise.race([exited, interruption]);
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);

    switch (settlement.status) {
      case "timed_out":
        return { status: "timed_out" };
      case "cancelled":
        return { status: "cancelled" };
      case "spawn_failed":
        return isExecutableMissing(settlement.error)
          ? { status: "unavailable", reason: "executable_missing" }
          : { status: "failed", reason: "launch_failed" };
      case "exited": {
        const [stdoutResult, stderrResult] = await Promise.all([stdout, stderr]);
        if (
          stdoutResult.status === "failed" ||
          stderrResult.status === "failed"
        )
          return { status: "failed", reason: "launch_failed" };
        return {
          status: "completed",
          exitCode: settlement.exitCode,
          stdout: stdoutResult.value,
          stderr: stderrResult.value,
        };
      }
      default:
        return assertNever(settlement);
    }
  };
}

export function mapCommandResult(
  result: AttentionCommandResult,
  sessionUnavailable: (output: string) => boolean,
): AttentionOutcome {
  switch (result.status) {
    case "completed":
      if (result.exitCode === 0) return { status: "submitted" };
      if (sessionUnavailable(`${result.stdout}\n${result.stderr}`))
        return { status: "unavailable", reason: "session_unavailable" };
      return {
        status: "failed",
        reason: "nonzero_exit",
        exitCode: result.exitCode,
      };
    case "unavailable":
      return result;
    case "failed":
      return result;
    case "timed_out":
      return { status: "failed", reason: "timeout" };
    case "cancelled":
      return result;
    default:
      return assertNever(result);
  }
}

async function readOutput(stream: ReadableStream<Uint8Array>): Promise<OutputRead> {
  try {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (size < ATTENTION_OUTPUT_LIMIT_BYTES) {
        const remaining = ATTENTION_OUTPUT_LIMIT_BYTES - size;
        const chunk = next.value.slice(0, remaining);
        chunks.push(chunk);
        size += chunk.byteLength;
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { status: "read", value: new TextDecoder().decode(bytes) };
  } catch (error) {
    if (error instanceof Error) return { status: "failed" };
    throw error;
  }
}

function isExecutableMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected attention result: ${String(value)}`);
}
