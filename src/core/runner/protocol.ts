import { constants } from "node:fs";
import { unlink, writeFile, rename, open, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { READY_MARKER, AUTHORIZATION_MARKER, STOP_MARKER } from "./types.js";

const wait = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });

const waitForExactFile = async (
  path: string,
  expected: string,
  timeoutMs: number,
  pollMs: number,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const fd = await open(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      let value: string;
      try {
        const stat = await fd.stat();
        if (!stat.isFile())
          throw new Error("protocol file is not a regular file");
        value = await fd.readFile("utf8");
      } finally {
        await fd.close();
      }
      if (value !== expected) throw new Error("protocol marker is invalid");
      await unlink(path);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await wait(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
  throw new Error("protocol marker timed out");
};

export const waitForAuthorization = (
  path: string,
  timeoutMs = 30_000,
  pollMs = 50,
): Promise<void> =>
  waitForExactFile(path, AUTHORIZATION_MARKER, timeoutMs, pollMs);

const writeMarker = async (path: string, marker: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, marker, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
};

export const writeAuthorization = (path: string): Promise<void> =>
  writeMarker(path, AUTHORIZATION_MARKER);

export async function writeStopControl(path: string): Promise<void> {
  await writeMarker(path, STOP_MARKER);
}

export async function publishReady(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const fd = await open(temp, "wx", 0o600);
  try {
    await fd.writeFile(READY_MARKER, "utf8");
    await fd.sync();
    await fd.close();
    await rename(temp, path);
  } catch (error) {
    await fd.close().catch(() => undefined);
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

export const waitForReady = (
  path: string,
  timeoutMs = 30_000,
  pollMs = 50,
): Promise<void> => waitForExactFile(path, READY_MARKER, timeoutMs, pollMs);
