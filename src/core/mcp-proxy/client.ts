import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { RemoteMcpError } from "./errors";
import {
  InitializeResultSchema,
  JsonRpcRequestSchema,
  JsonRpcResponseSchema,
  REMOTE_MCP_BODY_CAP,
  REMOTE_MCP_DEFAULT_URL,
  REMOTE_MCP_PROTOCOL_VERSIONS,
  RemoteToolSchema,
  isSupportedRemoteVersion,
  type JsonObject,
  type JsonRpcId,
  type JsonRpcRequest,
  type RemoteMcpProtocolVersion,
  type RemoteTool,
  type RemoteToolCallResult,
} from "./types";

export type RemoteCredentialProvider = () => Promise<string>;
export type RemoteFetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface RemoteMcpClientOptions {
  url?: string;
  credentials: RemoteCredentialProvider;
  fetch?: RemoteFetchLike;
  connectTimeoutMs?: number;
  totalTimeoutMs?: number;
  requestedVersion?: RemoteMcpProtocolVersion;
}

const MAX_TOOL_NAME = 128;
const MAX_DESCRIPTION = 4_096;
const MAX_SCHEMA_DEPTH = 32;
const SAFE_TOOL_NAME = /^[\x21-\x7e]+$/;

function abortError(signal?: AbortSignal): unknown {
  return (
    signal?.reason ??
    new DOMException("The operation was aborted", "AbortError")
  );
}

function validateRemoteUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RemoteMcpError(
      "REMOTE_INVALID_URL",
      "Remote MCP URL is invalid.",
    );
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ipVersion = isIP(host);
  const mappedIpv4 = host.match(
    /^::ffff:(?:(\d+)\.(\d+)\.(\d+)\.(\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i,
  );
  const octets =
    ipVersion === 4
      ? host.split(".").map(Number)
      : mappedIpv4
        ? mappedIpv4[1]
          ? mappedIpv4.slice(1, 5).map(Number)
          : (() => {
              const high = Number.parseInt(mappedIpv4[5]!, 16);
              const low = Number.parseInt(mappedIpv4[6]!, 16);
              return [high >> 8, high & 255, low >> 8, low & 255];
            })()
        : [];
  const unsafeIpv4 =
    (ipVersion === 4 || mappedIpv4 !== null) &&
    (octets[0] === 0 ||
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127) ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
      octets[0]! >= 224);
  const unsafeIpv6 =
    ipVersion === 6 &&
    (host === "::1" ||
      host === "::" ||
      host.toLowerCase().startsWith("fc") ||
      host.toLowerCase().startsWith("fd") ||
      host.toLowerCase().startsWith("fe80:"));
  if (
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    ((unsafeIpv4 || unsafeIpv6) && !(loopback && url.protocol === "http:"))
  )
    throw new RemoteMcpError(
      "REMOTE_INVALID_URL",
      "Remote MCP URL must be HTTPS without credentials or fragments.",
    );
  return url.toString().replace(/\/$/, "");
}

function bodyBytes(value: unknown): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  if (encoded.byteLength > REMOTE_MCP_BODY_CAP)
    throw new RemoteMcpError(
      "REMOTE_BODY_TOO_LARGE",
      "Remote MCP JSON body exceeds 256 KiB.",
    );
  return encoded;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function validateSchemaDepth(value: unknown, depth = 0): void {
  if (depth > MAX_SCHEMA_DEPTH)
    throw new RemoteMcpError(
      "REMOTE_PROTOCOL_ERROR",
      "Remote MCP tool schema is too deep.",
    );
  if (Array.isArray(value)) {
    for (const item of value) validateSchemaDepth(item, depth + 1);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value))
      validateSchemaDepth(item, depth + 1);
  }
}

function parseRemoteTools(value: unknown): RemoteTool[] {
  const result = z
    .object({
      structuredContent: z.object({ result: z.array(z.unknown()) }),
    })
    .safeParse(value);
  if (!result.success)
    throw new RemoteMcpError(
      "REMOTE_PROTOCOL_ERROR",
      "Remote MCP tools/list response was invalid.",
    );
  return result.data.structuredContent.result.map((raw) => {
    const parsed = RemoteToolSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.name.length === 0 ||
      parsed.data.name.length > MAX_TOOL_NAME ||
      !SAFE_TOOL_NAME.test(parsed.data.name) ||
      (parsed.data.description?.length ?? 0) > MAX_DESCRIPTION
    )
      throw new RemoteMcpError(
        "REMOTE_PROTOCOL_ERROR",
        "Remote MCP tool metadata was invalid.",
      );
    validateSchemaDepth(parsed.data.inputSchema);
    return structuredClone(parsed.data);
  });
}

export class RemoteMcpClient {
  readonly url: string;
  private readonly credentials: RemoteCredentialProvider;
  private readonly requestFetch: RemoteFetchLike;
  private readonly connectTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly requestedVersion: RemoteMcpProtocolVersion;
  private invalidCredentialFingerprint: string | undefined;

  constructor(options: RemoteMcpClientOptions) {
    this.url = validateRemoteUrl(
      process.env.BROWSERLOGIN_MCP_REMOTE_URL ??
        options.url ??
        REMOTE_MCP_DEFAULT_URL,
    );
    this.credentials = options.credentials;
    this.requestFetch = options.fetch ?? fetch;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.totalTimeoutMs = options.totalTimeoutMs ?? 60_000;
    this.requestedVersion =
      options.requestedVersion ?? REMOTE_MCP_PROTOCOL_VERSIONS[0];
  }

  async hasCredentialChanged(): Promise<boolean> {
    let credential: string;
    try {
      credential = await this.credentials();
    } catch {
      throw new RemoteMcpError(
        "REMOTE_AUTH_FAILED",
        "Remote MCP credentials are unavailable.",
      );
    }
    const fingerprint = createHash("sha256").update(credential).digest("hex");
    if (this.invalidCredentialFingerprint === undefined) return true;
    if (fingerprint === this.invalidCredentialFingerprint) return false;
    this.invalidCredentialFingerprint = undefined;
    return true;
  }

  private async request<Result>(
    method: string,
    params: unknown,
    signal?: AbortSignal,
    notification = false,
  ): Promise<Result | undefined> {
    if (signal?.aborted) throw abortError(signal);
    let credential: string;
    try {
      credential = await this.credentials();
    } catch {
      throw new RemoteMcpError(
        "REMOTE_AUTH_FAILED",
        "Remote MCP credentials are unavailable.",
      );
    }
    if (!credential)
      throw new RemoteMcpError(
        "REMOTE_AUTH_FAILED",
        "Remote MCP credentials are unavailable.",
      );
    const fingerprint = createHash("sha256").update(credential).digest("hex");
    if (this.invalidCredentialFingerprint === fingerprint)
      throw new RemoteMcpError(
        "REMOTE_AUTH_FAILED",
        "Remote MCP credentials were rejected.",
      );
    const id: JsonRpcId | undefined = notification ? undefined : randomUUID();
    const request: JsonRpcRequest = { jsonrpc: "2.0", method, params };
    if (id !== undefined) request.id = id;
    if (!JsonRpcRequestSchema.safeParse(request).success)
      throw new RemoteMcpError(
        "REMOTE_PROTOCOL_ERROR",
        "Remote MCP request was invalid.",
      );
    const body = bodyBytes(request);
    const controller = new AbortController();
    const connectTimer = setTimeout(
      () =>
        controller.abort(
          new DOMException("Remote MCP connect timed out", "TimeoutError"),
        ),
      this.connectTimeoutMs,
    );
    const totalTimer = setTimeout(
      () =>
        controller.abort(
          new DOMException("Remote MCP request timed out", "TimeoutError"),
        ),
      this.totalTimeoutMs,
    );
    const onAbort = () => controller.abort(abortError(signal));
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await this.requestFetch(this.url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${credential}`,
        },
        body: Buffer.from(body),
        redirect: "manual",
        signal: controller.signal,
      });
      clearTimeout(connectTimer);
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        throw new RemoteMcpError(
          "REMOTE_REDIRECT_REJECTED",
          "Remote MCP redirects are not followed.",
          response.status,
        );
      }
      if (response.status === 202) return undefined;
      if (response.status === 401) {
        this.invalidCredentialFingerprint = fingerprint;
        await response.body?.cancel().catch(() => undefined);
        throw new RemoteMcpError(
          "REMOTE_AUTH_FAILED",
          "Remote MCP credentials were rejected.",
          401,
        );
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new RemoteMcpError(
          "REMOTE_UNAVAILABLE",
          "Remote MCP request failed.",
          response.status,
        );
      }
      if (!response.body) return undefined;
      const length = response.headers.get("content-length");
      if (length !== null && Number(length) > REMOTE_MCP_BODY_CAP) {
        await response.body.cancel().catch(() => undefined);
        throw new RemoteMcpError(
          "REMOTE_BODY_TOO_LARGE",
          "Remote MCP JSON body exceeds 256 KiB.",
        );
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > REMOTE_MCP_BODY_CAP)
            throw new RemoteMcpError(
              "REMOTE_BODY_TOO_LARGE",
              "Remote MCP JSON body exceeds 256 KiB.",
            );
          chunks.push(chunk.value);
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      } finally {
        reader.releaseLock();
      }
      if (chunks.length === 0) return undefined;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new RemoteMcpError(
          "REMOTE_PROTOCOL_ERROR",
          "Remote MCP response was invalid.",
        );
      }
      const envelope = JsonRpcResponseSchema.safeParse(parsed);
      if (!envelope.success || envelope.data.id !== id)
        throw new RemoteMcpError(
          "REMOTE_PROTOCOL_ERROR",
          "Remote MCP response envelope was invalid.",
        );
      if ("error" in envelope.data)
        throw new RemoteMcpError(
          "REMOTE_PROTOCOL_ERROR",
          "Remote MCP returned a JSON-RPC error.",
        );
      return envelope.data.result as Result;
    } catch (error) {
      if (error instanceof RemoteMcpError) throw error;
      if (signal?.aborted || isAbort(error))
        throw new RemoteMcpError(
          "REMOTE_CANCELLED",
          "Remote MCP request was cancelled.",
        );
      if (error instanceof DOMException && error.name === "TimeoutError")
        throw new RemoteMcpError(
          "REMOTE_TIMEOUT",
          "Remote MCP request timed out.",
        );
      throw new RemoteMcpError(
        "REMOTE_UNAVAILABLE",
        "Remote MCP request could not be completed.",
      );
    } finally {
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async initialize(signal?: AbortSignal): Promise<RemoteMcpProtocolVersion> {
    const result = await this.request<unknown>(
      "initialize",
      {
        protocolVersion: this.requestedVersion,
        capabilities: {},
        clientInfo: { name: "browserlogin-client", version: "0.1.0" },
      },
      signal,
    );
    const parsed = InitializeResultSchema.safeParse(result);
    if (
      !parsed.success ||
      !isSupportedRemoteVersion(parsed.data.protocolVersion)
    )
      throw new RemoteMcpError(
        "REMOTE_PROTOCOL_ERROR",
        "Remote MCP protocol version was not supported.",
      );
    return parsed.data.protocolVersion;
  }

  async initialized(signal?: AbortSignal): Promise<void> {
    await this.request("notifications/initialized", {}, signal, true);
  }

  async listTools(signal?: AbortSignal): Promise<RemoteTool[]> {
    const result = await this.request("tools/list", {}, signal);
    return parseRemoteTools(result);
  }

  async ping(signal?: AbortSignal): Promise<JsonObject> {
    const result = await this.request<unknown>("ping", {}, signal);
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new RemoteMcpError(
        "REMOTE_PROTOCOL_ERROR",
        "Remote MCP ping response was invalid.",
      );
    return result as JsonObject;
  }

  async callTool(
    name: string,
    arguments_: JsonObject = {},
    signal?: AbortSignal,
  ): Promise<RemoteToolCallResult> {
    const result = await this.request<unknown>(
      "tools/call",
      { name, arguments: arguments_ },
      signal,
    );
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new RemoteMcpError(
        "REMOTE_PROTOCOL_ERROR",
        "Remote MCP tool result was invalid.",
      );
    return result as RemoteToolCallResult;
  }

  async discover(signal?: AbortSignal): Promise<RemoteTool[]> {
    await this.initialize(signal);
    await this.initialized(signal);
    return this.listTools(signal);
  }
}
