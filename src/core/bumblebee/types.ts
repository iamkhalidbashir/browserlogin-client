import type { RawInput } from "../cdp/relay";

export type Point = { x: number; y: number };
export type Button = "none" | "left" | "middle" | "right";
export type ProfileName = "default" | "precise" | "fast" | "natural" | "messy";
export type CdpSender = {
  send(
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ): Promise<void> | void;
  close?(): Promise<void> | void;
};
export type Clock = { sleep(ms: number): Promise<void> };
export const REAL_CLOCK: Clock = {
  sleep: (ms) =>
    new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms))),
};
export type WorkerInput = RawInput;
export type FallbackMetrics = {
  classicalFallbacks: number;
  reasons: Record<string, number>;
};

export class CancellationError extends Error {
  constructor() {
    super("BUMBLEBEE_CANCELLED");
    this.name = "CancellationError";
  }
}

export type RandomSource = () => number;

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancellationError();
}

export async function sleepWithSignal(
  clock: Clock,
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (!signal) {
    await clock.sleep(ms);
    return;
  }
  let onAbort: (() => void) | undefined;
  const abort = new Promise<never>((_, reject) => {
    onAbort = () => reject(new CancellationError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([clock.sleep(ms), abort]);
    throwIfAborted(signal);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
