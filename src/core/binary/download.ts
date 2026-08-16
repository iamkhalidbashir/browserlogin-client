import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { BinaryManagerError, type DownloadOptions } from "./types.js";

const DEFAULT_HEADROOM = 700 * 1024 * 1024;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function defaultDiskSpace(path: string): Promise<{ available: number }> {
  const { statfs } = await import("node:fs/promises");
  const info = await statfs(path);
  return { available: Number(info.bavail) * Number(info.bsize) };
}

async function preflight(options: DownloadOptions): Promise<void> {
  const expected = options.expectedBytes ?? 0;
  if (!expected && !options.diskSpace) return;
  const disk = await (options.diskSpace ?? defaultDiskSpace)(
    dirname(options.destination),
  );
  if (
    disk.available <
    expected + (options.extractHeadroomBytes ?? DEFAULT_HEADROOM)
  ) {
    throw new BinaryManagerError(
      "Insufficient disk space for the CloakBrowser archive and extraction",
      "DISK_SPACE",
    );
  }
}

function emitProgress(
  options: DownloadOptions,
  downloaded: number,
  total: number | undefined,
  done: boolean,
): void {
  options.progress?.({ downloaded, total, done });
}

async function downloadAttempt(
  options: DownloadOptions,
  part: string,
  etagPath: string,
  allowResume = true,
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const existing = await stat(part)
    .then((value) => value.size)
    .catch(() => 0);
  const oldEtag = existing
    ? await readFile(etagPath, "utf8").catch(() => "")
    : "";
  const resumeRequested = allowResume && existing > 0 && Boolean(oldEtag);
  const headers = new Headers(options.headers);
  if (resumeRequested) {
    headers.set("Range", `bytes=${existing}-`);
    headers.set("If-Range", oldEtag);
  }
  const controller = new AbortController();
  const totalTimer = setTimeout(
    () => controller.abort(),
    options.totalTimeoutMs ?? 600_000,
  );
  const connectTimer = setTimeout(
    () => controller.abort(),
    options.connectTimeoutMs ?? 15_000,
  );
  let response: Response;
  try {
    response = await fetchImpl(options.url, {
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(connectTimer);
    throw new BinaryManagerError(
      "CloakBrowser download request failed",
      "DOWNLOAD_FAILED",
      { cause: error },
      true,
    );
  }
  clearTimeout(connectTimer);
  const responseEtag = response.headers.get("etag") ?? "";
  const canResume =
    existing > 0 &&
    Boolean(oldEtag) &&
    response.status === 206 &&
    responseEtag === oldEtag;
  const append = canResume;
  if (existing && !append) {
    await unlink(part).catch(() => undefined);
    await unlink(etagPath).catch(() => undefined);
  }
  if (resumeRequested && response.status === 200) {
    await response.body?.cancel();
    clearTimeout(totalTimer);
    return downloadAttempt(options, part, etagPath, false);
  }
  if (response.status === 206 && !append) {
    await response.body?.cancel();
    clearTimeout(totalTimer);
    return downloadAttempt(options, part, etagPath, false);
  }
  if (!response.ok && response.status !== 206) {
    clearTimeout(totalTimer);
    throw new BinaryManagerError(
      `CloakBrowser download failed: HTTP ${response.status}`,
      "DOWNLOAD_FAILED",
    );
  }
  if (!response.body) {
    clearTimeout(totalTimer);
    throw new BinaryManagerError(
      "CloakBrowser download returned an empty body",
      "DOWNLOAD_FAILED",
    );
  }
  const contentLength = Number(response.headers.get("content-length"));
  const total =
    Number.isFinite(contentLength) && contentLength > 0
      ? append
        ? existing + contentLength
        : contentLength
      : options.expectedBytes;
  const handle = await open(part, append ? "a" : "w", 0o600);
  let downloaded = append ? existing : 0;
  let lastProgress = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => controller.abort(),
      options.idleTimeoutMs ?? 30_000,
    );
  };
  try {
    if (responseEtag) await writeFile(etagPath, responseEtag, { mode: 0o600 });
    const reader = response.body.getReader();
    while (true) {
      resetIdle();
      const result = await reader.read();
      if (result.done) break;
      if (!result.value?.length) continue;
      await handle.write(result.value);
      downloaded += result.value.length;
      const now = Date.now();
      if (now - lastProgress >= 250) {
        lastProgress = now;
        emitProgress(options, downloaded, total, false);
      }
    }
  } catch (error) {
    throw new BinaryManagerError(
      "CloakBrowser download stream failed",
      "DOWNLOAD_FAILED",
      { cause: error },
      true,
    );
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    await handle.close();
    clearTimeout(totalTimer);
  }
  if (total !== undefined && downloaded !== total)
    throw new BinaryManagerError(
      "CloakBrowser download was truncated",
      "DOWNLOAD_FAILED",
    );
  emitProgress(options, downloaded, total, true);
}

export async function downloadVerifiedSource(
  options: DownloadOptions,
): Promise<string> {
  await mkdir(dirname(options.destination), { recursive: true, mode: 0o700 });
  let sized = options;
  if (options.expectedBytes === undefined) {
    try {
      const response = await (options.fetchImpl ?? fetch)(options.url, {
        method: "HEAD",
        headers: options.headers,
        redirect: "follow",
        signal: AbortSignal.timeout(options.connectTimeoutMs ?? 15_000),
      });
      const length = Number(response.headers.get("content-length"));
      if (response.ok && Number.isFinite(length) && length >= 0)
        sized = { ...options, expectedBytes: length };
    } catch {
      sized = options;
    }
  }
  await preflight(sized);
  const part = `${options.destination}.part`;
  const etagPath = `${part}.etag`;
  let lastError: unknown;
  for (let attempt = 0; attempt < (options.retries ?? 3); attempt += 1) {
    try {
      await downloadAttempt(sized, part, etagPath);
      await rename(part, options.destination);
      await unlink(etagPath).catch(() => undefined);
      return options.destination;
    } catch (error) {
      lastError = error;
      if (
        error instanceof BinaryManagerError &&
        (!error.retryable || error.code !== "DOWNLOAD_FAILED")
      )
        throw error;
      if (attempt + 1 < (options.retries ?? 3)) await sleep(100 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new BinaryManagerError("CloakBrowser download failed", "DOWNLOAD_FAILED");
}
