import { RemoteMcpError } from "./errors";
import {
  REMOTE_MCP_DISCOVERY_BUDGET_MS,
  REMOTE_MCP_RETRY_INTERVAL_MS,
  type RemoteMcpStatus,
  type RemoteTool,
} from "./types";
import type { RemoteMcpClient } from "./client";

function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException("The operation was aborted", "AbortError")
  );
}

function waitForAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export class RemoteMcpDiscoveryCache {
  private tools: RemoteTool[] = [];
  private discoveryStatus: RemoteMcpStatus = "REMOTE_UNAVAILABLE";
  private inFlight: Promise<RemoteTool[]> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private activeController: AbortController | undefined;
  private stopped = false;
  private lastAttemptAt = -Infinity;
  private attemptCount = 0;
  private retryCount = 0;

  constructor(private readonly client: RemoteMcpClient) {}

  get status(): RemoteMcpStatus {
    return this.discoveryStatus;
  }

  get discoveredTools(): readonly RemoteTool[] {
    return this.tools;
  }

  get attempts(): number {
    return this.attemptCount;
  }

  get scheduledRetries(): number {
    return this.retryCount;
  }

  async discover(signal?: AbortSignal): Promise<readonly RemoteTool[]> {
    if (this.stopped) return this.tools;
    if (signal?.aborted) return this.tools;
    if (this.discoveryStatus === "READY") return this.tools;
    if (this.discoveryStatus === "REMOTE_AUTH_FAILED") {
      if (!(await this.client.hasCredentialChanged())) return this.tools;
    }
    if (this.inFlight) return waitForAbort(this.inFlight, signal);
    const now = Date.now();
    if (now - this.lastAttemptAt < REMOTE_MCP_RETRY_INTERVAL_MS)
      return this.tools;
    this.lastAttemptAt = now;
    this.attemptCount += 1;
    const controller = new AbortController();
    this.activeController = controller;
    const timer = setTimeout(
      () => controller.abort(),
      REMOTE_MCP_DISCOVERY_BUDGET_MS,
    );
    this.inFlight = this.client
      .discover(controller.signal)
      .then((tools) => {
        this.tools = tools.map((tool) => structuredClone(tool));
        this.discoveryStatus = "READY";
        return this.tools;
      })
      .catch((error: unknown) => {
        this.tools = [];
        this.discoveryStatus =
          error instanceof RemoteMcpError &&
          error.remoteCode === "REMOTE_AUTH_FAILED"
            ? "REMOTE_AUTH_FAILED"
            : "REMOTE_UNAVAILABLE";
        if (this.discoveryStatus === "REMOTE_UNAVAILABLE") this.scheduleRetry();
        return this.tools;
      })
      .finally(() => {
        clearTimeout(timer);
        this.activeController = undefined;
        this.inFlight = undefined;
      });
    return waitForAbort(this.inFlight, signal);
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer !== undefined) return;
    this.retryCount += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.discover();
    }, REMOTE_MCP_RETRY_INTERVAL_MS);
  }

  shutdown(): void {
    this.stopped = true;
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    this.activeController?.abort();
    this.activeController = undefined;
    this.retryTimer = undefined;
  }
}
