import { createHash } from "node:crypto";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { ArchiveError } from "../../shared/errors.js";
import type { TransferProgressCallback } from "./archive-transfer.js";

const CHUNK_BYTES = 64 * 1024;

type UploadInput = {
  readonly url: string;
  readonly path: string;
  readonly expectedSize?: number;
  readonly expectedSha256?: string;
  readonly maxBytes: number;
  readonly idleTimeoutMs: number;
  readonly signal: AbortSignal;
  readonly fetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  readonly onProgress?: TransferProgressCallback;
};

type UploadTransfer = {
  readonly response: Response;
  readonly complete: () => void;
};

type StreamOutcome =
  | { readonly kind: "complete" }
  | { readonly kind: "failed"; readonly error: unknown };

function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException("The operation was aborted", "AbortError")
  );
}

async function digestHandle(
  handle: FileHandle,
  size: number,
  signal: AbortSignal,
): Promise<string> {
  const hash = createHash("sha256");
  let offset = 0;
  while (offset < size) {
    if (signal.aborted) throw abortReason(signal);
    const buffer = new Uint8Array(Math.min(CHUNK_BYTES, size - offset));
    const { bytesRead } = await handle.read(
      buffer,
      0,
      buffer.byteLength,
      offset,
    );
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  if (offset !== size)
    throw new ArchiveError("archive upload bytes changed during preflight");
  return hash.digest("hex");
}

export async function streamArchiveUpload(
  input: UploadInput,
): Promise<UploadTransfer> {
  let pathInfo: Awaited<ReturnType<typeof lstat>>;
  try {
    pathInfo = await lstat(input.path);
  } catch (error) {
    throw new ArchiveError("archive upload payload could not be opened", {
      cause: error,
    });
  }
  if (!pathInfo?.isFile() || pathInfo.isSymbolicLink())
    throw new ArchiveError("archive upload payload must be a regular file");
  const handle = await open(input.path, "r");
  try {
    const snapshot = await handle.stat();
    if (!snapshot.isFile())
      throw new ArchiveError("archive upload payload must be a regular file");
    if (snapshot.size > input.maxBytes)
      throw new ArchiveError("archive upload exceeds configured maximum size");
    if (
      input.expectedSize !== undefined &&
      snapshot.size !== input.expectedSize
    )
      throw new ArchiveError(
        "archive upload bytes changed after metadata was persisted",
      );
    const expectedDigest = await digestHandle(
      handle,
      snapshot.size,
      input.signal,
    );
    if (
      input.expectedSha256 !== undefined &&
      expectedDigest !== input.expectedSha256
    )
      throw new ArchiveError(
        "archive upload bytes changed after metadata was persisted",
      );

    input.onProgress?.({
      direction: "upload",
      transferred: 0,
      total: snapshot.size,
      done: false,
    });
    const streamedHash = createHash("sha256");
    let transferred = 0;
    let settleStream: (outcome: StreamOutcome) => void = () => undefined;
    const streamed = new Promise<StreamOutcome>((resolvePromise) => {
      settleStream = resolvePromise;
    });
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (input.signal.aborted) throw abortReason(input.signal);
          if (transferred === snapshot.size) {
            controller.close();
            settleStream({ kind: "complete" });
            return;
          }
          const buffer = new Uint8Array(
            Math.min(CHUNK_BYTES, snapshot.size - transferred),
          );
          const read = handle.read(buffer, 0, buffer.byteLength, transferred);
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new DOMException("Archive stream timed out", "TimeoutError"),
                ),
              input.idleTimeoutMs,
            );
          });
          let result: Awaited<typeof read>;
          try {
            result = await Promise.race([read, timeout]);
          } finally {
            if (timer !== undefined) clearTimeout(timer);
          }
          if (result.bytesRead === 0)
            throw new ArchiveError(
              "archive upload bytes changed while streaming",
            );
          const chunk = buffer.subarray(0, result.bytesRead);
          transferred += result.bytesRead;
          streamedHash.update(chunk);
          controller.enqueue(chunk);
          input.onProgress?.({
            direction: "upload",
            transferred,
            total: snapshot.size,
            done: false,
          });
        } catch (error) {
          controller.error(error);
          settleStream({ kind: "failed", error });
        }
      },
      cancel(reason) {
        settleStream({
          kind: "failed",
          error: new ArchiveError("archive upload stream was cancelled", {
            cause: reason,
          }),
        });
      },
    });
    const request: RequestInit & { readonly duplex: "half" } = {
      method: "POST",
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(snapshot.size),
        Accept: "application/json",
      },
      body,
      duplex: "half",
      redirect: "manual",
      signal: input.signal,
    };
    const response = await input.fetch(input.url, request);
    const outcome = await streamed;
    switch (outcome.kind) {
      case "complete":
        break;
      case "failed":
        throw outcome.error;
    }
    const finalState = await handle.stat();
    if (
      transferred !== snapshot.size ||
      finalState.size !== snapshot.size ||
      streamedHash.digest("hex") !== expectedDigest
    )
      throw new ArchiveError("archive upload bytes changed while streaming");
    let completed = false;
    return {
      response,
      complete: () => {
        if (completed) return;
        completed = true;
        input.onProgress?.({
          direction: "upload",
          transferred: snapshot.size,
          total: snapshot.size,
          done: true,
        });
      },
    };
  } finally {
    await handle.close();
  }
}
