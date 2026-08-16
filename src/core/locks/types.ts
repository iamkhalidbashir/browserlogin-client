export type ProcessStartTime = string;

export type LockOwner = {
  pid: number;
  process_start_time: ProcessStartTime;
  hostname: string;
  created_at: string;
};

export type LockProbe = {
  pid: number;
  process_start_time: ProcessStartTime;
  alive: boolean;
};

export type LockOptions = {
  timeoutMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
  now?: () => Date;
  owner?: LockOwner;
};

export class LockTimeoutError extends Error {
  constructor(
    public readonly lockPath: string,
    public readonly timeoutMs: number,
  ) {
    super(`Timed out waiting for lock: ${lockPath}`);
    this.name = "LockTimeoutError";
  }
}

export class LockAbortedError extends Error {
  constructor(public readonly lockPath: string) {
    super(`Lock acquisition aborted: ${lockPath}`);
    this.name = "LockAbortedError";
  }
}
