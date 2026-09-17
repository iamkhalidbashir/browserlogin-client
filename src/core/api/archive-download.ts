import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ArchiveIdentity } from "../../shared/api-types.js";
import { ArchiveError, PreconditionError } from "../../shared/errors.js";
import type { TransferProgressCallback } from "./archive-transfer.js";

type DownloadInput = {
  readonly response: Response;
  readonly identity: ArchiveIdentity;
  readonly destination: string;
  readonly maxBytes: number;
  readonly idleTimeoutMs: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: TransferProgressCallback;
};

type ReadResult =
  | { readonly done: true; readonly value?: undefined }
  | { readonly done: false; readonly value: Uint8Array };

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
  signal?: AbortSignal,
): Promise<ReadResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new DOMException("Archive stream timed out", "TimeoutError")),
      idleTimeoutMs,
    );
  });
  const aborted = signal
    ? new Promise<never>((_, reject) => {
        onAbort = () =>
          reject(
            signal.reason ??
              new DOMException("The operation was aborted", "AbortError"),
          );
        signal.addEventListener("abort", onAbort, { once: true });
      })
    : undefined;
  try {
    return await Promise.race(
      aborted ? [reader.read(), timeout, aborted] : [reader.read(), timeout],
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

export async function streamArchiveDownload(
  input: DownloadInput,
): Promise<string> {
  const contentLength = input.response.headers.get("content-length");
  const length = contentLength === null ? Number.NaN : Number(contentLength);
  const expectedDigest = `sha-256=${Buffer.from(input.identity.sha256, "hex").toString("base64")}`;
  if (
    input.response.headers.get("etag") !== `"${input.identity.sha256}"` ||
    input.response.headers.get("x-archive-generation") !==
      String(input.identity.generation) ||
    input.response.headers.get("digest") !== expectedDigest ||
    !Number.isSafeInteger(length) ||
    length !== input.identity.size
  )
    throw new ArchiveError(
      "archive identity headers do not match requested archive",
    );
  if (!input.response.body)
    throw new ArchiveError("archive response did not contain a body");

  const target = resolve(input.destination);
  const temporary = `${target}.${randomUUID()}.tmp`;
  const reader = input.response.body.getReader();
  let transferred = 0;
  const hash = createHash("sha256");
  input.onProgress?.({
    direction: "download",
    transferred: 0,
    total: input.identity.size,
    done: false,
  });
  try {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const output = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
    let outputError: unknown;
    output.on("error", (error) => {
      outputError = error;
    });
    try {
      while (true) {
        const result = await readWithTimeout(
          reader,
          input.idleTimeoutMs,
          input.signal,
        );
        if (result.done) break;
        if (outputError) throw outputError;
        transferred += result.value.byteLength;
        if (transferred > input.identity.size || transferred > input.maxBytes)
          throw new ArchiveError(
            "archive exceeded declared or configured size",
          );
        hash.update(result.value);
        if (!output.write(result.value))
          await new Promise<void>((resolvePromise, reject) => {
            output.once("drain", resolvePromise);
            output.once("error", reject);
          });
        input.onProgress?.({
          direction: "download",
          transferred,
          total: input.identity.size,
          done: false,
        });
      }
      await new Promise<void>((resolvePromise, reject) => {
        output.end(resolvePromise);
        output.once("error", reject);
      });
      if (outputError) throw outputError;
    } finally {
      output.destroy();
    }
    if (
      transferred !== input.identity.size ||
      hash.digest("hex") !== input.identity.sha256
    )
      throw new PreconditionError(
        "archive length or SHA-256 verification failed",
      );
    await rename(temporary, target);
    input.onProgress?.({
      direction: "download",
      transferred,
      total: input.identity.size,
      done: true,
    });
    return target;
  } catch (error) {
    await Promise.allSettled([reader.cancel(), rm(temporary, { force: true })]);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
