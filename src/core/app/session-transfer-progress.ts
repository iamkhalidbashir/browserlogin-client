import type { TransferProgress } from "../api/archive-transfer.js";

export type SessionTransferDirection = TransferProgress["direction"];
export type SessionTransferStatus = "running" | "completed" | "failed";

export type SessionTransferProgressSnapshot = Readonly<{
  profileId: string;
  direction: SessionTransferDirection;
  transferred: number;
  total: number;
  percentage: number;
  status: SessionTransferStatus;
}>;

type SessionTransferProgressStoreOptions = Readonly<{
  now?: () => number;
  terminalTtlMs?: number;
}>;

type ProgressEntry = Readonly<{
  snapshot: SessionTransferProgressSnapshot;
  terminalAt?: number;
}>;

const DEFAULT_TERMINAL_TTL_MS = 30_000;

export class SessionTransferProgressStore {
  private readonly entries = new Map<string, ProgressEntry>();
  private readonly now: () => number;
  private readonly terminalTtlMs: number;

  constructor(options: SessionTransferProgressStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.terminalTtlMs = options.terminalTtlMs ?? DEFAULT_TERMINAL_TTL_MS;
  }

  record(profileId: string, progress: TransferProgress): void {
    this.assertProgress(profileId, progress);
    const key = this.key(profileId, progress.direction);
    const current = this.entries.get(key)?.snapshot;
    if (!current || current.status !== "running") {
      if (progress.transferred !== 0 || progress.done)
        throw new TypeError("a transfer attempt must begin at zero");
    } else {
      if (progress.transferred < current.transferred)
        throw new TypeError("transfer bytes must be monotonic");
      if (progress.total !== current.total)
        throw new TypeError("transfer total must remain stable");
    }

    const status = progress.done ? "completed" : "running";
    const percentage = progress.done
      ? 100
      : Math.min(
          99,
          progress.total === 0
            ? 0
            : Math.max(
                0,
                Math.min(
                  100,
                  Number(
                    (BigInt(progress.transferred) * 100n) /
                      BigInt(progress.total),
                  ),
                ),
              ),
        );
    this.entries.set(key, {
      snapshot: {
        profileId,
        direction: progress.direction,
        transferred: progress.transferred,
        total: progress.total,
        percentage,
        status,
      },
      ...(progress.done ? { terminalAt: this.now() } : {}),
    });
  }

  fail(profileId: string, direction: SessionTransferDirection): void {
    const key = this.key(profileId, direction);
    const current = this.entries.get(key)?.snapshot;
    if (!current || current.status !== "running") return;
    this.entries.set(key, {
      snapshot: { ...current, status: "failed" },
      terminalAt: this.now(),
    });
  }

  snapshot(): readonly SessionTransferProgressSnapshot[] {
    const now = this.now();
    const result: SessionTransferProgressSnapshot[] = [];
    for (const [key, entry] of this.entries) {
      if (
        entry.terminalAt !== undefined &&
        now - entry.terminalAt >= this.terminalTtlMs
      ) {
        this.entries.delete(key);
        continue;
      }
      result.push(entry.snapshot);
      if (entry.terminalAt !== undefined) this.entries.delete(key);
    }
    return result;
  }

  private assertProgress(profileId: string, progress: TransferProgress): void {
    if (
      profileId.length === 0 ||
      (progress.direction !== "download" && progress.direction !== "upload") ||
      !Number.isSafeInteger(progress.transferred) ||
      progress.transferred < 0 ||
      !Number.isSafeInteger(progress.total) ||
      progress.total < 0
    )
      throw new TypeError("transfer progress must use nonnegative integers");
  }

  private key(profileId: string, direction: SessionTransferDirection): string {
    return `${direction}\0${profileId}`;
  }
}
