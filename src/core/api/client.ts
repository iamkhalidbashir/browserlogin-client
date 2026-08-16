import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import {
  ArchiveIdentitySchema,
  AuditEventSchema,
  MemberSchema,
  NoteVersionSchema,
  ProfileSchema,
  ProxySchema,
  SessionSchema,
  StartResponseSchema,
  UserSchema,
  type ArchiveIdentity,
  type AuditEvent,
  type Member,
  type NoteVersion,
  type Profile,
  type Proxy,
  type Session,
  type StartResponse,
  type User,
} from "../../shared/api-types.js";
import {
  ApiError,
  ArchiveError,
  ConflictError,
  PreconditionError,
} from "../../shared/errors.js";
import { DEFAULT_BASE_URL } from "../config/connection.js";

const JSON_BODY_CAP = 256 * 1024;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 120_000;
const MAX_GET_RETRIES = 2;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_JSON_RESPONSE_BYTES = 8 * 1024 * 1024;
const ARCHIVE_IDLE_TIMEOUT_MS = 30_000;
const SHA256 = /^[0-9a-f]{64}$/;
type ReadChunk =
  { done: true; value?: undefined } | { done: false; value: Uint8Array };

const statusSchema = z.object({ status: z.string() }).passthrough();
const notesSchema = z
  .object({ notes: z.string(), version: z.number().int() })
  .passthrough();
const versionSchema = z.object({ version: z.number().int() }).passthrough();
const changeIpSchema = z
  .object({ id: z.string(), ip: z.string(), changed_at: z.string() })
  .passthrough();
const uploadGrantSchema = z
  .object({
    upload_url: z.string(),
    expires_at: z.string(),
    session_id: z.string(),
  })
  .passthrough();
const uploadResponseSchema = z
  .object({
    storageId: z.string().optional(),
    storage_id: z.string().optional(),
  })
  .passthrough();

export type CredentialProvider = () => Promise<string>;
export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
export type Sleep = (
  milliseconds: number,
  signal: AbortSignal,
) => Promise<void>;

export interface UploadGrant {
  upload_url: string;
  expires_at: string;
  session_id: string;
}

export interface ProfileCreateInput {
  name: string;
  seed?: number;
  proxy_id?: string;
  platform?: string;
  geoip?: boolean;
  humanize?: boolean;
  human_preset?: string;
  bumblebee_profile?: string;
  headless?: boolean;
  timezone?: string;
  locale?: string;
  user_agent?: string;
  viewport?: unknown;
  args?: string[];
}

export type ProfileUpdateInput = ProfileCreateInput & {
  expected_config_version: number;
};
export interface ProxyInput {
  name: string;
  protocol: "http" | "socks5";
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  change_ip_url?: string | null;
}

export interface ArchiveCommit {
  storage_id: string;
  size: number;
  sha256: string;
  format: "zip";
}

export interface ClientOptions {
  baseUrl?: string;
  credentials: CredentialProvider;
  fetch?: FetchLike;
  timeoutMs?: number;
  connectTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxArchiveBytes?: number;
  now?: () => number;
  sleep?: Sleep;
  random?: () => number;
}

function validateBaseUrl(value: string): string {
  if (value !== value.trim() || value.includes("\n") || value.includes("\r"))
    throw new TypeError("base URL must be an absolute HTTPS URL");
  const url = new URL(value);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    (url.protocol !== "https:" && !loopback) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new TypeError(
      "base URL must use HTTPS without credentials or query data",
    );
  return value.replace(/\/$/, "");
}

function validateId(value: string, label: string): string {
  if (!value) throw new TypeError(`${label} must be non-empty`);
  return encodeURIComponent(value);
}

function validateIdempotencyKey(value: string): string {
  if (value.length < 1 || value.length > 100)
    throw new TypeError("idempotency key must contain 1-100 characters");
  return value;
}

function jsonBody(body: unknown): string {
  const encoded = JSON.stringify(body);
  if (new TextEncoder().encode(encoded).byteLength > JSON_BODY_CAP)
    throw new ApiError(413, "JSON request body exceeds 256 KiB");
  return encoded;
}

function schemaError(status: number, operation: string): ApiError {
  return new ApiError(status, `${operation} response failed schema validation`);
}

function parse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  status: number,
  operation: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw schemaError(status, operation);
  return result.data;
}

function errorForStatus(status: number, operation: string): ApiError {
  if (status === 409) return new ConflictError(`${operation} conflicted`);
  if (status === 412)
    return new PreconditionError(`${operation} precondition failed`);
  const error = new ApiError(status, `${operation} failed`);
  if (status === 401) error.code = "UNAUTHORIZED";
  else if (status === 422) error.code = "VALIDATION_FAILED";
  else if (status === 429) error.code = "RATE_LIMITED";
  else if (status >= 500) error.code = "UPSTREAM_ERROR";
  return error;
}

function defaultSleep(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (signal.aborted) {
      reject(
        signal.reason ??
          new DOMException("The operation was aborted", "AbortError"),
      );
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolvePromise();
    }, milliseconds);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(
        signal.reason ??
          new DOMException("The operation was aborted", "AbortError"),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function readJsonResponse(
  response: Response,
  maxBytes: number,
  timeoutMs: number,
): Promise<unknown> {
  if (!response.body) throw new Error("response did not contain a body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new DOMException("Response timed out", "TimeoutError")),
          timeoutMs,
        );
      });
      let result: ReadChunk;
      try {
        result = (await Promise.race([
          reader.read(),
          timeout,
        ])) as unknown as ReadChunk;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes)
        throw new ApiError(413, "JSON response exceeds configured limit");
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function readArchiveChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadChunk> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new DOMException("Archive stream timed out", "TimeoutError")),
      ARCHIVE_IDLE_TIMEOUT_MS,
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
    return (await Promise.race(
      aborted ? [reader.read(), timeout, aborted] : [reader.read(), timeout],
    )) as unknown as ReadChunk;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

export class BrowserLoginClient {
  readonly baseUrl: string;
  private readonly credentials: CredentialProvider;
  private readonly requestFetch: FetchLike;
  private readonly connectTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly maxArchiveBytes: number;
  private readonly now: () => number;
  private readonly sleep: Sleep;
  private readonly random: () => number;

  constructor(options: ClientOptions) {
    this.baseUrl = validateBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.credentials = options.credentials;
    this.requestFetch = options.fetch ?? fetch;
    this.connectTimeoutMs =
      options.connectTimeoutMs ??
      options.timeoutMs ??
      DEFAULT_CONNECT_TIMEOUT_MS;
    this.totalTimeoutMs =
      options.totalTimeoutMs ?? options.timeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
    this.maxArchiveBytes = options.maxArchiveBytes ?? MAX_ARCHIVE_BYTES;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  private async request(
    method: string,
    path: string,
    options: {
      body?: unknown;
      accept?: string;
      headers?: Record<string, string>;
      signal?: AbortSignal;
      retryGet?: boolean;
      streaming?: boolean;
    } = {},
  ): Promise<Response> {
    if (options.signal?.aborted)
      throw (
        options.signal.reason ??
        new DOMException("The operation was aborted", "AbortError")
      );
    const body =
      options.body === undefined ? undefined : jsonBody(options.body);
    const key = options.headers?.["Idempotency-Key"];
    if (key !== undefined) validateIdempotencyKey(key);
    const authorization = await this.credentials();
    if (!authorization)
      throw new ApiError(401, "credential provider returned no API key");
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${authorization}`);
    headers.set("Accept", options.accept ?? "application/json");
    if (body !== undefined) {
      headers.set("Content-Type", "application/json");
      headers.set(
        "Content-Length",
        String(new TextEncoder().encode(body).byteLength),
      );
    }
    const attempts =
      options.retryGet && method === "GET" ? MAX_GET_RETRIES + 1 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const connectTimeout = setTimeout(
        () =>
          controller.abort(
            new DOMException("Connection timed out", "TimeoutError"),
          ),
        this.connectTimeoutMs,
      );
      const totalTimeout = options.streaming
        ? undefined
        : setTimeout(
            () =>
              controller.abort(
                new DOMException("Request timed out", "TimeoutError"),
              ),
            this.totalTimeoutMs,
          );
      const abort = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", abort, { once: true });
      try {
        const response = await this.requestFetch(`${this.baseUrl}${path}`, {
          method,
          headers,
          body,
          redirect: "manual",
          signal: controller.signal,
        });
        clearTimeout(connectTimeout);
        if (response.status >= 300 && response.status < 400)
          throw new ApiError(
            response.status,
            "redirects are not followed by the API client",
          );
        if (
          response.ok ||
          attempt === attempts - 1 ||
          ![408, 429, 500, 502, 503, 504].includes(response.status)
        )
          return response;
        await response.body?.cancel();
      } catch (error) {
        if (
          options.signal?.aborted ||
          attempt === attempts - 1 ||
          error instanceof ApiError
        )
          throw error;
      } finally {
        clearTimeout(connectTimeout);
        if (totalTimeout !== undefined) clearTimeout(totalTimeout);
        options.signal?.removeEventListener("abort", abort);
      }
      await this.sleep(
        Math.min(250, 50 * 2 ** attempt + Math.floor(this.random() * 51)),
        options.signal ?? new AbortController().signal,
      );
    }
    throw new ApiError(599, "request retry policy exhausted");
  }

  private async json<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    operation: string,
    options: Parameters<BrowserLoginClient["request"]>[2] = {},
  ): Promise<T> {
    const response = await this.request(method, path, options);
    if (!response.ok) {
      await cancelBody(response);
      throw errorForStatus(response.status, operation);
    }
    let value: unknown;
    try {
      value = await readJsonResponse(
        response,
        MAX_JSON_RESPONSE_BYTES,
        this.totalTimeoutMs,
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw schemaError(response.status, operation);
    }
    return parse(schema, value, response.status, operation);
  }

  private mutationKey(
    required: boolean,
    override?: string,
  ): Record<string, string> {
    return required
      ? { "Idempotency-Key": validateIdempotencyKey(override ?? randomUUID()) }
      : {};
  }

  getUser(): Promise<User> {
    return this.json("GET", "/user", UserSchema, "get user", {
      retryGet: true,
    });
  }
  getMe(): Promise<User> {
    return this.json("GET", "/me", UserSchema, "get me", { retryGet: true });
  }
  getOwner(): Promise<User> {
    return this.json("GET", "/owner", UserSchema, "get owner", {
      retryGet: true,
    });
  }
  listProfiles(): Promise<Profile[]> {
    return this.json(
      "GET",
      "/profiles",
      z.array(ProfileSchema),
      "list profiles",
      { retryGet: true },
    );
  }
  getProfile(profileId: string): Promise<Profile> {
    return this.json(
      "GET",
      `/profiles/${validateId(profileId, "profile id")}`,
      ProfileSchema,
      "get profile",
      { retryGet: true },
    );
  }
  createProfile(
    input: ProfileCreateInput,
    idempotencyKey?: string,
  ): Promise<Profile> {
    return this.json("POST", "/profiles", ProfileSchema, "create profile", {
      body: input,
      headers: this.mutationKey(true, idempotencyKey),
    });
  }
  updateProfile(
    profileId: string,
    input: ProfileUpdateInput,
  ): Promise<Profile> {
    return this.json(
      "PATCH",
      `/profiles/${validateId(profileId, "profile id")}`,
      ProfileSchema,
      "update profile",
      { body: input },
    );
  }
  deleteProfile(profileId: string): Promise<{ status: string }> {
    return this.json(
      "DELETE",
      `/profiles/${validateId(profileId, "profile id")}`,
      statusSchema,
      "delete profile",
    );
  }
  restoreProfile(profileId: string): Promise<{ status: string }> {
    return this.json(
      "POST",
      `/profiles/${validateId(profileId, "profile id")}/restore`,
      statusSchema,
      "restore profile",
    );
  }
  listMembers(profileId: string): Promise<Member[]> {
    return this.json(
      "GET",
      `/profiles/${validateId(profileId, "profile id")}/members`,
      z.array(MemberSchema),
      "list profile members",
      { retryGet: true },
    );
  }
  shareProfile(
    profileId: string,
    userId: string,
    role: string,
  ): Promise<{ status: string }> {
    return this.json(
      "POST",
      `/profiles/${validateId(profileId, "profile id")}/members`,
      statusSchema,
      "share profile",
      { body: { user_id: userId, role } },
    );
  }
  removeMember(profileId: string, userId: string): Promise<{ status: string }> {
    return this.json(
      "DELETE",
      `/profiles/${validateId(profileId, "profile id")}/members/${validateId(userId, "user id")}`,
      statusSchema,
      "remove profile member",
    );
  }
  getNotes(profileId: string): Promise<{ notes: string; version: number }> {
    return this.json(
      "GET",
      `/profiles/${validateId(profileId, "profile id")}/notes`,
      notesSchema,
      "get profile notes",
      { retryGet: true },
    );
  }
  appendNotes(
    profileId: string,
    notes: string,
    expectedVersion: number,
  ): Promise<{ version: number }> {
    return this.json(
      "POST",
      `/profiles/${validateId(profileId, "profile id")}/notes`,
      versionSchema,
      "append profile notes",
      { body: { notes, expected_version: expectedVersion } },
    );
  }
  replaceNotes(
    profileId: string,
    notes: string,
    expectedVersion: number,
  ): Promise<{ version: number }> {
    return this.json(
      "PUT",
      `/profiles/${validateId(profileId, "profile id")}/notes`,
      versionSchema,
      "replace profile notes",
      { body: { notes, expected_version: expectedVersion } },
    );
  }
  listNoteHistory(profileId: string): Promise<NoteVersion[]> {
    return this.json(
      "GET",
      `/profiles/${validateId(profileId, "profile id")}/notes/history`,
      z.array(NoteVersionSchema),
      "list note history",
      { retryGet: true },
    );
  }
  listNotesHistory(profileId: string): Promise<NoteVersion[]> {
    return this.json(
      "GET",
      `/profiles/${validateId(profileId, "profile id")}/notes-history`,
      z.array(NoteVersionSchema),
      "list notes history",
      { retryGet: true },
    );
  }
  async startSession(
    profileId: string,
    idempotencyKey?: string,
  ): Promise<StartResponse> {
    const result = await this.json(
      "POST",
      `/profiles/${validateId(profileId, "profile id")}/sessions`,
      StartResponseSchema,
      "start session",
      { body: {}, headers: this.mutationKey(true, idempotencyKey) },
    );
    if (
      result.session.profile_id !== profileId ||
      result.profile.id !== profileId
    )
      throw new ApiError(
        200,
        "start session response failed identity validation",
      );
    return result;
  }
  getSession(sessionId: string): Promise<Session> {
    return this.json(
      "GET",
      `/sessions/${validateId(sessionId, "session id")}`,
      SessionSchema,
      "get session",
      { retryGet: true },
    );
  }
  sessionStatus(sessionId: string): Promise<Session> {
    return this.json(
      "GET",
      `/sessions/${validateId(sessionId, "session id")}/status`,
      SessionSchema,
      "get session status",
      { retryGet: true },
    );
  }
  stopSession(
    sessionId: string,
    archive: ArchiveCommit | undefined,
    idempotencyKey?: string,
  ): Promise<Session> {
    return this.json(
      "POST",
      `/sessions/${validateId(sessionId, "session id")}/stop`,
      SessionSchema,
      "stop session",
      {
        body: archive ? { archive } : {},
        headers: this.mutationKey(true, idempotencyKey),
      },
    );
  }
  forceStopSession(
    sessionId: string,
    idempotencyKey?: string,
  ): Promise<Session> {
    return this.json(
      "POST",
      `/sessions/${validateId(sessionId, "session id")}/stop`,
      SessionSchema,
      "force stop session",
      {
        body: { force: true },
        headers: this.mutationKey(true, idempotencyKey),
      },
    );
  }
  normalStopWithoutArchive(
    sessionId: string,
    idempotencyKey?: string,
  ): Promise<Session> {
    return this.stopSession(sessionId, undefined, idempotencyKey);
  }
  getArchive(profileId: string): Promise<{ archive: ArchiveIdentity | null }> {
    return this.json(
      "GET",
      `/profiles/${validateId(profileId, "profile id")}/archive`,
      z.object({ archive: ArchiveIdentitySchema.nullable() }).passthrough(),
      "get archive",
      { retryGet: true },
    );
  }
  listProxies(): Promise<Proxy[]> {
    return this.json("GET", "/proxies", z.array(ProxySchema), "list proxies", {
      retryGet: true,
    });
  }
  createProxy(input: ProxyInput, idempotencyKey?: string): Promise<Proxy> {
    return this.json("POST", "/proxies", ProxySchema, "create proxy", {
      body: input,
      headers: this.mutationKey(true, idempotencyKey),
    });
  }
  updateProxy(proxyId: string, input: ProxyInput): Promise<Proxy> {
    return this.json(
      "PATCH",
      `/proxies/${validateId(proxyId, "proxy id")}`,
      ProxySchema,
      "update proxy",
      { body: input },
    );
  }
  deleteProxy(proxyId: string): Promise<{ status: string }> {
    return this.json(
      "DELETE",
      `/proxies/${validateId(proxyId, "proxy id")}`,
      statusSchema,
      "delete proxy",
    );
  }
  async changeProxyIp(
    proxyId: string,
  ): Promise<{ id: string; ip: string; changed_at: string }> {
    const result = await this.json(
      "POST",
      `/proxies/${validateId(proxyId, "proxy id")}/change-ip`,
      changeIpSchema,
      "change proxy IP",
      { body: {} },
    );
    if (
      result.id !== proxyId ||
      isIP(result.ip) === 0 ||
      !/(?:Z|[+-]\d\d:\d\d)$/.test(result.changed_at) ||
      !Number.isFinite(Date.parse(result.changed_at))
    )
      throw new ApiError(
        200,
        "change proxy IP response failed semantic validation",
      );
    return result;
  }
  listUsers(): Promise<User[]> {
    return this.json("GET", "/users", z.array(UserSchema), "list users", {
      retryGet: true,
    });
  }
  disableUser(userId: string): Promise<{ status: string }> {
    return this.json(
      "POST",
      `/users/${validateId(userId, "user id")}/disable`,
      statusSchema,
      "disable user",
      { body: {} },
    );
  }
  listAudit(profileId?: string): Promise<AuditEvent[]> {
    return this.json(
      "GET",
      `/audit${profileId ? `?profile_id=${encodeURIComponent(profileId)}` : ""}`,
      z.array(AuditEventSchema),
      "list audit events",
      { retryGet: true },
    );
  }

  async requestUploadUrl(
    profileId: string,
    expectedSessionId: string,
  ): Promise<UploadGrant> {
    const grant = await this.json(
      "POST",
      `/profiles/${validateId(profileId, "profile id")}/archive-upload-url`,
      uploadGrantSchema,
      "request archive upload URL",
      { body: {} },
    );
    if (grant.session_id !== expectedSessionId)
      throw new ArchiveError("upload URL is bound to a different session");
    const url = new URL(grant.upload_url);
    if (url.protocol !== "https:" || url.username || url.password || url.hash)
      throw new ArchiveError("archive upload URL is invalid");
    const expiry = Date.parse(grant.expires_at);
    if (!Number.isFinite(expiry) || expiry <= this.now())
      throw new ArchiveError("archive upload URL is expired or invalid");
    return grant;
  }

  async directUpload(
    grant: UploadGrant,
    payload: string,
    options: {
      expectedSize?: number;
      expectedSha256?: string;
      signal?: AbortSignal;
      expectedSessionId: string;
    },
  ): Promise<string> {
    const { expectedSize, expectedSha256, signal, expectedSessionId } = options;
    if (signal?.aborted)
      throw (
        signal.reason ??
        new DOMException("The operation was aborted", "AbortError")
      );
    let url: URL;
    try {
      url = new URL(grant.upload_url);
    } catch (error) {
      throw new ArchiveError("archive upload URL is invalid", { cause: error });
    }
    if (grant.session_id !== expectedSessionId)
      throw new ArchiveError("upload URL is bound to a different session");
    const expiry = Date.parse(grant.expires_at);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash ||
      !Number.isFinite(expiry) ||
      expiry <= this.now()
    )
      throw new ArchiveError("archive upload URL is invalid or expired");
    const payloadInfo = await lstat(payload).catch(() => undefined);
    if (!payloadInfo?.isFile() || payloadInfo.isSymbolicLink())
      throw new ArchiveError("archive upload payload must be a regular file");
    if (payloadInfo.size > this.maxArchiveBytes)
      throw new ArchiveError("archive upload exceeds configured maximum size");
    const bytes = await readFile(payload);
    if (bytes.length > this.maxArchiveBytes)
      throw new ArchiveError("archive upload exceeds configured maximum size");
    if (expectedSize !== undefined && bytes.length !== expectedSize)
      throw new ArchiveError(
        "archive upload bytes changed after metadata was persisted",
      );
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (expectedSha256 !== undefined && digest !== expectedSha256)
      throw new ArchiveError(
        "archive upload bytes changed after metadata was persisted",
      );
    const controller = new AbortController();
    const connectTimeout = setTimeout(
      () =>
        controller.abort(
          new DOMException("Connection timed out", "TimeoutError"),
        ),
      this.connectTimeoutMs,
    );
    const totalTimeout = setTimeout(
      () =>
        controller.abort(new DOMException("Request timed out", "TimeoutError")),
      this.totalTimeoutMs,
    );
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.requestFetch(grant.upload_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          "Content-Length": String(bytes.length),
          Accept: "application/json",
        },
        body: bytes,
        redirect: "manual",
        signal: controller.signal,
      });
      clearTimeout(connectTimeout);
      if (response.status >= 300 && response.status < 400)
        await cancelBody(response);
      if (response.status >= 300 && response.status < 400)
        throw new ApiError(
          response.status,
          "redirects are not followed by the API client",
        );
      if (!response.ok) {
        await cancelBody(response);
        throw errorForStatus(response.status, "upload archive");
      }
      let value: unknown;
      try {
        value = await readJsonResponse(
          response,
          MAX_JSON_RESPONSE_BYTES,
          this.totalTimeoutMs,
        );
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ArchiveError("archive upload response was invalid");
      }
      const result = parse(
        uploadResponseSchema,
        value,
        response.status,
        "upload archive",
      );
      const storageId = result.storageId ?? result.storage_id;
      if (!storageId)
        throw new ArchiveError("archive upload response omitted storageId");
      return storageId;
    } finally {
      clearTimeout(connectTimeout);
      clearTimeout(totalTimeout);
      signal?.removeEventListener("abort", abort);
    }
  }

  async downloadArchive(
    identity: ArchiveIdentity,
    destination: string,
    signal?: AbortSignal,
  ): Promise<string> {
    if (
      !SHA256.test(identity.sha256) ||
      identity.format !== "zip" ||
      identity.size < 0 ||
      identity.size > this.maxArchiveBytes
    )
      throw new ArchiveError("invalid expected archive identity");
    const response = await this.request(
      "GET",
      `/profiles/${validateId(identity.profile_id, "profile id")}/archive/download?generation=${identity.generation}`,
      {
        accept: "application/octet-stream",
        headers: { "If-Match": `"${identity.sha256}"` },
        signal,
        streaming: true,
        retryGet: true,
      },
    );
    if (!response.ok) {
      await cancelBody(response);
      throw errorForStatus(response.status, "download archive");
    }
    const etag = response.headers.get("etag");
    const generation = response.headers.get("x-archive-generation");
    const digest = response.headers.get("digest");
    const contentLength = response.headers.get("content-length");
    const length = contentLength === null ? Number.NaN : Number(contentLength);
    const expectedDigest = `sha-256=${Buffer.from(identity.sha256, "hex").toString("base64")}`;
    if (
      etag !== `"${identity.sha256}"` ||
      generation !== String(identity.generation) ||
      digest !== expectedDigest ||
      !Number.isSafeInteger(length) ||
      length !== identity.size
    ) {
      await cancelBody(response);
      throw new ArchiveError(
        "archive identity headers do not match requested archive",
      );
    }
    if (!response.body)
      throw new ArchiveError("archive response did not contain a body");
    const target = resolve(destination);
    const temporary = `${target}.${randomUUID()}.tmp`;
    let count = 0;
    const hash = createHash("sha256");
    const reader = response.body.getReader();
    try {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const output = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
      let outputError: unknown;
      output.on("error", (error) => {
        outputError = error;
      });
      try {
        while (true) {
          const result = await readArchiveChunk(reader, signal);
          if (result.done) break;
          const chunk = result.value;
          if (outputError) throw outputError;
          count += chunk.byteLength;
          if (count > identity.size || count > this.maxArchiveBytes)
            throw new ArchiveError(
              "archive exceeded declared or configured size",
            );
          hash.update(chunk);
          if (!output.write(chunk))
            await new Promise<void>((resolvePromise, reject) => {
              output.once("drain", resolvePromise);
              output.once("error", reject);
            });
        }
        await new Promise<void>((resolvePromise, reject) => {
          output.end(() => resolvePromise());
          if (outputError) reject(outputError);
        });
        if (outputError) throw outputError;
      } finally {
        output.destroy();
      }
      if (count !== identity.size || hash.digest("hex") !== identity.sha256)
        throw new PreconditionError(
          "archive length or SHA-256 verification failed",
        );
      await rename(temporary, target);
      return target;
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      await cancelBody(response);
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
}
