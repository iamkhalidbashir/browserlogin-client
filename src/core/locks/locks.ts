import { createHash } from "node:crypto";
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { currentOwner, isMatchingLiveProcess } from "./platform.js";
import {
  LockAbortedError,
  LockTimeoutError,
  type LockOptions,
  type LockOwner,
} from "./types.js";

const mutexes = new Map<string, Promise<void>>();
const MALFORMED_LOCK_GRACE_MS = 30_000;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const ownerBytes = (owner: LockOwner) =>
  JSON.stringify({
    pid: owner.pid,
    process_start_time: owner.process_start_time,
    hostname: owner.hostname,
    created_at: owner.created_at,
  });

const readOwner = async (
  lockPath: string,
): Promise<{ owner: LockOwner; bytes: string } | undefined> => {
  try {
    const bytes = await readFile(lockPath, "utf8");
    const owner = JSON.parse(bytes) as LockOwner;
    if (
      typeof owner.pid !== "number" ||
      typeof owner.process_start_time !== "string" ||
      typeof owner.hostname !== "string" ||
      typeof owner.created_at !== "string"
    )
      return undefined;
    return { owner, bytes };
  } catch {
    return undefined;
  }
};

const removeIfOwnerMatches = async (
  lockPath: string,
  expectedBytes: string,
): Promise<boolean> => {
  try {
    const actual = await readFile(lockPath, "utf8");
    if (actual !== expectedBytes) return false;
    await unlink(lockPath);
    return true;
  } catch {
    return false;
  }
};

const reclaimStale = async (lockPath: string): Promise<boolean> => {
  const record = await readOwner(lockPath);
  if (!record) {
    try {
      const info = await stat(lockPath);
      if (Date.now() - info.mtimeMs < MALFORMED_LOCK_GRACE_MS) return false;
      const bytes = await readFile(lockPath, "utf8");
      return await removeIfOwnerMatches(lockPath, bytes);
    } catch {
      return false;
    }
  }
  const live = await isMatchingLiveProcess(
    record.owner.pid,
    record.owner.process_start_time,
  );
  return live ? false : await removeIfOwnerMatches(lockPath, record.bytes);
};

const acquireFileLock = async (
  lockPath: string,
  options: LockOptions,
): Promise<() => Promise<void>> => {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pollMs = options.pollMs ?? 10;
  const deadline = Date.now() + timeoutMs;
  const owner = options.owner ?? (await currentOwner(options.now));
  const bytes = ownerBytes(owner);
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });

  while (true) {
    if (options.signal?.aborted) throw new LockAbortedError(lockPath);
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.write(bytes);
      } finally {
        await handle.close();
      }
      return async () => {
        await removeIfOwnerMatches(lockPath, bytes);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await reclaimStale(lockPath)) continue;
      if (Date.now() >= deadline)
        throw new LockTimeoutError(lockPath, timeoutMs);
      await sleep(pollMs);
    }
  }
};

const enqueue = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
  const previous = mutexes.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  mutexes.set(key, queued);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (mutexes.get(key) === queued) mutexes.delete(key);
  }
};

export const withLock = async <T>(
  lockPath: string,
  work: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> =>
  enqueue(lockPath, async () => {
    const release = await acquireFileLock(lockPath, options);
    try {
      return await work();
    } finally {
      await release();
    }
  });

export const lockOwnerPayload = (owner: LockOwner): string => ownerBytes(owner);

export const lockName = (name: string): string =>
  createHash("sha256").update(name).digest("hex").slice(0, 24);
