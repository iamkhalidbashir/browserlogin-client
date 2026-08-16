import { randomBytes } from "node:crypto";
import { request as httpsRequest } from "node:https";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { readFile, unlink } from "node:fs/promises";
import { licenseRelayLock } from "../locks/names.js";
import { currentOwner, getProcessStartTime } from "../locks/platform.js";
import { atomicWriteJson, readJson } from "../config/store.js";
import {
  ensureStatePaths,
  posixPathSecurity,
  statePaths,
  type PathSecurity,
  type StatePaths,
} from "../config/paths.js";
import { withLock } from "../locks/locks.js";

export const RELAY_PROTOCOL_VERSION = 1;
export const DEFAULT_RELAY_PORT = 4290;
export const MAX_REQUEST_BYTES = 64 * 1024;
export const MAX_RESPONSE_BYTES = 256 * 1024;
export const CLIENT_TIMEOUT_MS = 5_000;
export const UPSTREAM_TIMEOUT_MS = 15_000;
export const MAX_CONCURRENT_REQUESTS = 16;
export const DEFAULT_UPSTREAM_URL = "https://cloakbrowser.dev:443";

export const LICENSE_ROUTES = [
  "/api/license/session/start",
  "/api/license/session/heartbeat",
  "/api/license/session/end",
] as const;

const PEER_ROUTE = "/__browserlogin/license-relay/peer";
const CONTROL_NAME = "license-relay.json";
const LEGACY_CONTROL_NAME = "license-relay.control.json";
const ALLOWED_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "content-length",
  "content-type",
  "host",
  "user-agent",
  "connection",
]);
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

export type RelayControl = {
  port: number;
  pid: number;
  start_time: string;
  nonce: string;
};

export type RelayResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
};

export type UpstreamRequest = {
  route: (typeof LICENSE_ROUTES)[number];
  headers: Record<string, string>;
  body: Buffer;
};

export type UpstreamTransport = (
  request: UpstreamRequest,
) => Promise<RelayResponse>;

export type RelayOptions = {
  root: string;
  port?: number;
  env?: NodeJS.ProcessEnv;
  upstreamUrl?: string;
  transport?: UpstreamTransport;
  nonce?: string;
  security?: PathSecurity;
};

export type LicenseRelay = {
  server: Server;
  control: RelayControl;
  paths: StatePaths;
  close(): Promise<void>;
};

const errorText: Record<number, string> = {
  400: "bad request\n",
  401: "unauthorized\n",
  404: "not found\n",
  405: "method not allowed\n",
  408: "request timeout\n",
  413: "request too large\n",
  429: "too many requests\n",
  502: "upstream unavailable\n",
  504: "upstream timeout\n",
};

const sendError = (response: ServerResponse, status: number): void => {
  const body = Buffer.from(errorText[status] ?? "relay error\n", "utf8");
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": body.length,
    connection: "close",
  });
  response.end(body);
};

const assertLicenseUrl = (value: string): string => {
  if (
    [...value].some((character) => character.charCodeAt(0) > 0x7f) ||
    Buffer.byteLength(value, "ascii") > 24
  )
    throw new Error("license API URL must be at most 24 ASCII bytes");
  const parsed = new URL(value);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("license API URL must be a pure HTTP(S) origin");
  return value;
};

export const relayUrl = (port: number): string => {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new RangeError("relay port is invalid");
  return assertLicenseUrl(`http://127.0.0.1:${port}`);
};

const controlPath = (paths: StatePaths): string =>
  `${paths.state}/${CONTROL_NAME}`;

const legacyControlPath = (paths: StatePaths): string =>
  `${paths.state}/${LEGACY_CONTROL_NAME}`;

const controlFromUnknown = (value: unknown): RelayControl => {
  if (!value || typeof value !== "object")
    throw new Error("relay control is invalid");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "nonce,pid,port,start_time" ||
    typeof record.nonce !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.nonce) ||
    typeof record.pid !== "number" ||
    !Number.isInteger(record.pid) ||
    record.pid < 1 ||
    typeof record.port !== "number" ||
    !Number.isInteger(record.port) ||
    record.port < 1 ||
    record.port > 65535 ||
    typeof record.start_time !== "string" ||
    !record.start_time
  )
    throw new Error("relay control is invalid");
  relayUrl(record.port);
  return {
    nonce: record.nonce,
    pid: record.pid,
    port: record.port,
    start_time: record.start_time,
  };
};

export const readRelayControl = async (
  root: string,
  security: PathSecurity = posixPathSecurity(),
): Promise<RelayControl | null> => {
  const paths = statePaths(root);
  const value = await readJson<unknown>(controlPath(paths), security);
  return value === null ? null : controlFromUnknown(value);
};

const rawHeaderCounts = (request: IncomingMessage): Map<string, number> => {
  const counts = new Map<string, number>();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index].toLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
};

const requestSize = (request: IncomingMessage): number => {
  let size = Buffer.byteLength(
    `${request.method ?? ""} ${request.url ?? ""} HTTP/1.1\r\n`,
    "ascii",
  );
  for (let index = 0; index < request.rawHeaders.length; index += 2)
    size += Buffer.byteLength(
      `${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}\r\n`,
      "ascii",
    );
  return size + 2;
};

const advertisedEncodings = (
  request: IncomingMessage,
): { accepted: Set<string>; denied: Set<string>; wildcard: boolean } => {
  const accepted = new Set<string>();
  const denied = new Set<string>();
  let wildcard = false;
  for (const raw of (request.headers["accept-encoding"] ?? "").split(",")) {
    const parts = raw
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts[0]) continue;
    let quality = 1;
    for (const parameter of parts.slice(1)) {
      const [name, value] = parameter.split("=", 2);
      if (name?.toLowerCase() === "q") {
        const parsed = Number(value);
        quality =
          Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
      }
    }
    const coding = parts[0].toLowerCase();
    if (coding === "*") wildcard = quality > 0;
    else if (quality > 0) accepted.add(coding);
    else denied.add(coding);
  }
  return { accepted, denied, wildcard };
};

const validateRequest = (
  request: IncomingMessage,
): { length: number; headers: Record<string, string> } | number => {
  if (request.method !== "POST") return 405;
  if (
    !request.url ||
    !LICENSE_ROUTES.includes(request.url as (typeof LICENSE_ROUTES)[number])
  )
    return 404;
  if (requestSize(request) > MAX_REQUEST_BYTES) return 413;
  const counts = rawHeaderCounts(request);
  for (const [name, count] of counts) {
    if (!ALLOWED_HEADERS.has(name) || count !== 1) return 400;
  }
  if (counts.has("transfer-encoding") || counts.has("expect")) return 400;
  const rawLength = request.headers["content-length"];
  if (typeof rawLength !== "string" || !/^\d+$/.test(rawLength)) return 400;
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length)) return 400;
  if (
    length > MAX_REQUEST_BYTES ||
    requestSize(request) + length > MAX_REQUEST_BYTES
  )
    return 413;
  const headers: Record<string, string> = {};
  for (const name of ALLOWED_HEADERS) {
    const value = request.headers[name];
    if (
      typeof value === "string" &&
      !["host", "content-length", "connection"].includes(name)
    )
      headers[name] = value;
  }
  headers.host = "cloakbrowser.dev";
  headers["content-length"] = String(length);
  return { length, headers };
};

const responseEncodingAllowed = (
  response: RelayResponse,
  request: IncomingMessage,
): boolean => {
  const encoding = response.headers["content-encoding"];
  if (!encoding || Array.isArray(encoding)) return !Array.isArray(encoding);
  const preferences = advertisedEncodings(request);
  return encoding
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .every(
      (token) =>
        token === "identity" ||
        (!preferences.denied.has(token) &&
          (preferences.accepted.has(token) || preferences.wildcard)),
    );
};

class RelayTimeoutError extends Error {
  constructor(readonly kind: "client" | "upstream") {
    super(`${kind} timeout`);
  }
}

class RelayBodyError extends Error {
  constructor() {
    super("client body mismatch");
  }
}

const writeUpstreamResponse = (
  response: ServerResponse,
  upstream: RelayResponse,
): void => {
  if (upstream.body.length > MAX_RESPONSE_BYTES)
    return sendError(response, 502);
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (value !== undefined && !HOP_BY_HOP_HEADERS.has(name.toLowerCase()))
      headers[name] = value;
  }
  headers["content-length"] = String(upstream.body.length);
  headers.connection = "close";
  response.writeHead(upstream.status, headers);
  response.end(upstream.body);
};

const defaultTransport = (upstreamUrl: string): UpstreamTransport => {
  const target = new URL(upstreamUrl);
  if (target.protocol !== "https:")
    throw new Error("license upstream must use HTTPS");
  return ({ route, headers, body }) =>
    new Promise<RelayResponse>((resolve, reject) => {
      const request = httpsRequest(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || 443,
          path: route,
          method: "POST",
          headers,
          servername: target.hostname,
          rejectUnauthorized: true,
          timeout: UPSTREAM_TIMEOUT_MS,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size <= MAX_RESPONSE_BYTES + 1) chunks.push(chunk);
          });
          response.on("end", () =>
            resolve({
              status: response.statusCode ?? 502,
              headers: response.headers,
              body: Buffer.concat(chunks),
            }),
          );
          response.on("error", reject);
        },
      );
      request.on("timeout", () =>
        request.destroy(new Error("upstream timeout")),
      );
      request.on("error", reject);
      request.end(body);
    });
};

const readBody = (request: IncomingMessage, length: number): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= length) chunks.push(chunk);
    });
    request.on("end", () => {
      request.setTimeout(0);
      if (size === length) resolve(Buffer.concat(chunks));
      else reject(new RelayBodyError());
    });
    request.on("error", reject);
    request.setTimeout(CLIENT_TIMEOUT_MS, () =>
      reject(new RelayTimeoutError("client")),
    );
  });

const makeHandler =
  (
    control: RelayControl,
    transport: UpstreamTransport,
    active: { value: number },
  ) =>
  async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method === "GET" && request.url === PEER_ROUTE) {
      if (request.headers["x-browserlogin-relay-nonce"] !== control.nonce)
        return sendError(response, 401);
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": 2,
        connection: "close",
      });
      response.end("{}", "utf8");
      return;
    }
    const validation = validateRequest(request);
    if (typeof validation === "number") return sendError(response, validation);
    if (active.value >= MAX_CONCURRENT_REQUESTS)
      return sendError(response, 429);
    active.value += 1;
    try {
      const body = await readBody(request, validation.length);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const upstream = await Promise.race([
          transport({
            route: request.url as (typeof LICENSE_ROUTES)[number],
            headers: validation.headers,
            body,
          }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new RelayTimeoutError("upstream")),
              UPSTREAM_TIMEOUT_MS,
            );
          }),
        ]);
        if (!responseEncodingAllowed(upstream, request))
          return sendError(response, 502);
        writeUpstreamResponse(response, upstream);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    } catch (error) {
      sendError(
        response,
        error instanceof RelayBodyError
          ? 400
          : error instanceof RelayTimeoutError && error.kind === "client"
            ? 408
            : error instanceof RelayTimeoutError && error.kind === "upstream"
              ? 504
              : error instanceof Error && error.message === "upstream timeout"
                ? 504
                : 502,
      );
    } finally {
      active.value -= 1;
    }
  };

const listen = (server: Server, port: number): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(new Error("relay address is unavailable"));
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });

const portCandidates = (
  requested: number | undefined,
  env: NodeJS.ProcessEnv,
): number[] => {
  if (requested !== undefined) {
    if (!Number.isInteger(requested) || requested < 0 || requested > 65535)
      throw new RangeError("relay port is invalid");
    return [requested];
  }
  const raw = env.BROWSERLOGIN_LICENSE_PORT?.trim();
  if (raw) {
    if (!/^\d+$/.test(raw))
      throw new RangeError("relay environment port is invalid");
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 65535)
      throw new RangeError("relay environment port is invalid");
    return [value];
  }
  return Array.from({ length: 110 }, (_, index) => DEFAULT_RELAY_PORT + index);
};

const removeLegacyControl = async (
  paths: StatePaths,
  security: PathSecurity,
): Promise<void> => {
  const path = legacyControlPath(paths);
  try {
    await security.verify(path, false);
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};

export const startLicenseRelay = async (
  options: RelayOptions,
): Promise<LicenseRelay> => {
  const paths = statePaths(options.root);
  const security = options.security ?? posixPathSecurity();
  await ensureStatePaths(paths, security);
  const nonce = options.nonce ?? randomBytes(32).toString("hex");
  if (!/^[0-9a-f]{64}$/.test(nonce))
    throw new Error("relay nonce must be 64 lowercase hex characters");
  return withLock(licenseRelayLock(paths.locks), async () => {
    await removeLegacyControl(paths, security);
    const existing = await readRelayControl(options.root, security);
    if (existing) throw new Error("license relay is already owned");
    const owner = await currentOwner();
    const startTime = await getProcessStartTime(process.pid);
    const controlBase = {
      pid: owner.pid,
      start_time: startTime ?? owner.process_start_time,
      nonce,
    };
    const transport =
      options.transport ??
      defaultTransport(options.upstreamUrl ?? DEFAULT_UPSTREAM_URL);
    const active = { value: 0 };
    let server: Server | undefined;
    let port = 0;
    for (const candidate of portCandidates(
      options.port,
      options.env ?? process.env,
    )) {
      const candidateServer = createServer((request, response) => {
        void makeHandler(
          { ...controlBase, port },
          transport,
          active,
        )(request, response);
      });
      candidateServer.maxHeadersCount = 32;
      candidateServer.headersTimeout = CLIENT_TIMEOUT_MS;
      candidateServer.requestTimeout = CLIENT_TIMEOUT_MS;
      try {
        port = await listen(candidateServer, candidate);
        server = candidateServer;
        break;
      } catch (error) {
        candidateServer.close();
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      }
    }
    if (!server || !port)
      throw new Error("no loopback relay port is available");
    const control: RelayControl = { ...controlBase, port };
    relayUrl(port);
    try {
      await atomicWriteJson(controlPath(paths), control, security);
    } catch (error) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      await unlink(controlPath(paths)).catch(() => undefined);
      throw error;
    }
    const close = async (): Promise<void> => {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      const current = await readFile(controlPath(paths), "utf8").catch(
        () => undefined,
      );
      if (current === `${JSON.stringify(control, null, 2)}\n`)
        await unlink(controlPath(paths)).catch(() => undefined);
    };
    return { server, control, paths, close };
  });
};

export const probeExistingRelay = async (
  control: RelayControl,
  nonce: string,
): Promise<boolean> => {
  if (nonce !== control.nonce) return false;
  const response = await fetch(
    `${relayUrl(control.port)}/__browserlogin/license-relay/peer`,
    {
      headers: { "x-browserlogin-relay-nonce": nonce },
    },
  ).catch(() => undefined);
  if (!response) return false;
  return (
    response.status === 200 &&
    (await getProcessStartTime(control.pid)) === control.start_time
  );
};

export const discoverExistingRelay = async (
  root: string,
  nonce: string,
  security: PathSecurity = posixPathSecurity(),
): Promise<RelayControl | null> => {
  return withLock(licenseRelayLock(statePaths(root).locks), async () => {
    const control = await readRelayControl(root, security);
    if (!control || !(await probeExistingRelay(control, nonce))) return null;
    return control;
  });
};

export const controlFileName = CONTROL_NAME;
