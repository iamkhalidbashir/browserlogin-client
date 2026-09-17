import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ATTENTION_COMMAND_TIMEOUT_MS,
  ATTENTION_OUTPUT_LIMIT_BYTES,
  createCommandRunner,
  type AttentionSpawn,
  type AttentionSpawnRequest,
  type AttentionSubprocess,
} from "../../src/core/attention/command.js";

const encoder = new TextEncoder();

function outputStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function exitedProcess(
  exitCode: number,
  stdout = "",
  stderr = "",
): AttentionSubprocess {
  return {
    stdout: outputStream(stdout),
    stderr: outputStream(stderr),
    exited: Promise.resolve(exitCode),
    kill: vi.fn(),
  };
}

class ExecutableMissingError extends Error {
  readonly code = "ENOENT";
}

afterEach(() => {
  vi.useRealTimers();
});

describe("native attention command runner", () => {
  it("submits an argv-only process with bounded pipe configuration", async () => {
    // Given
    let request: AttentionSpawnRequest | undefined;
    const spawn: AttentionSpawn = (input) => {
      request = input;
      return exitedProcess(0, "ok");
    };
    const run = createCommandRunner(spawn);

    // When
    const result = await run({
      executable: "/fixed/program",
      args: ["--literal", "$(not-a-shell)"],
    });

    // Then
    expect(request).toEqual({
      cmd: ["/fixed/program", "--literal", "$(not-a-shell)"],
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      maxBuffer: ATTENTION_OUTPUT_LIMIT_BYTES,
    });
    expect(request).not.toHaveProperty("shell");
    expect(result).toEqual({
      status: "completed",
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    });
  });

  it("bounds captured stdout and stderr", async () => {
    // Given
    const oversized = "x".repeat(ATTENTION_OUTPUT_LIMIT_BYTES + 512);
    const run = createCommandRunner(() => exitedProcess(9, oversized, oversized));

    // When
    const result = await run({ executable: "/fixed/program", args: [] });

    // Then
    expect(result).toEqual({
      status: "completed",
      exitCode: 9,
      stdout: "x".repeat(ATTENTION_OUTPUT_LIMIT_BYTES),
      stderr: "x".repeat(ATTENTION_OUTPUT_LIMIT_BYTES),
    });
  });

  it("reports a missing executable as unavailable", async () => {
    // Given
    const run = createCommandRunner(() => {
      throw new ExecutableMissingError("missing");
    });

    // When
    const result = await run({ executable: "/missing/program", args: [] });

    // Then
    expect(result).toEqual({
      status: "unavailable",
      reason: "executable_missing",
    });
  });

  it("reports another spawn error as a launch failure", async () => {
    // Given
    const run = createCommandRunner(() => {
      throw new TypeError("invalid spawn request");
    });

    // When
    const result = await run({ executable: "/fixed/program", args: [] });

    // Then
    expect(result).toEqual({ status: "failed", reason: "launch_failed" });
  });

  it("kills a command and reports timeout after exactly five seconds", async () => {
    // Given
    vi.useFakeTimers();
    let resolveExit: ((code: number) => void) | undefined;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const kill = vi.fn(() => resolveExit?.(143));
    const run = createCommandRunner(() => ({
      stdout: outputStream(""),
      stderr: outputStream(""),
      exited,
      kill,
    }));

    // When
    const pending = run({ executable: "/fixed/program", args: [] });
    await vi.advanceTimersByTimeAsync(ATTENTION_COMMAND_TIMEOUT_MS - 1);

    // Then
    expect(kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ status: "timed_out" });
    expect(kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("force-kills a timed-out command that ignores termination", async () => {
    // Given
    vi.useFakeTimers();
    const kill = vi.fn();
    const run = createCommandRunner(() => ({
      stdout: outputStream(""),
      stderr: outputStream(""),
      exited: new Promise<number>(() => undefined),
      kill,
    }));

    // When
    const pending = run({ executable: "/fixed/program", args: [] });
    await vi.advanceTimersByTimeAsync(ATTENTION_COMMAND_TIMEOUT_MS);
    await pending;
    await vi.advanceTimersByTimeAsync(100);

    // Then
    expect(kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });

  it("kills an active command and reports caller cancellation", async () => {
    // Given
    const controller = new AbortController();
    let resolveExit: ((code: number) => void) | undefined;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const kill = vi.fn(() => resolveExit?.(143));
    const run = createCommandRunner(() => ({
      stdout: outputStream(""),
      stderr: outputStream(""),
      exited,
      kill,
    }));
    const pending = run(
      { executable: "/fixed/program", args: [] },
      { signal: controller.signal },
    );

    // When
    controller.abort();

    // Then
    await expect(pending).resolves.toEqual({ status: "cancelled" });
    expect(kill).toHaveBeenCalledWith("SIGTERM");
  });
});
