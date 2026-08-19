import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";

export const MAX_CDP_MESSAGE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_CDP_TIMEOUT_MS = 30_000;
export const MAX_CDP_TIMEOUT_MS = 120_000;

export const INTERCEPTED_INPUT_METHODS = new Set([
  "Input.dispatchMouseEvent",
  "Input.dispatchKeyEvent",
  "Input.insertText",
  "Input.dispatchTouchEvent",
]);

type JsonRecord = Record<string, unknown>;
type Frame = string | RawData;
type Socket = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
};

export type RawInput = {
  method:
    | "Input.dispatchMouseEvent"
    | "Input.dispatchKeyEvent"
    | "Input.insertText"
    | "Input.dispatchTouchEvent";
  params: JsonRecord;
  sessionId?: string;
  targetId?: string;
};

export type RawInputWorker = {
  execute(event: RawInput, signal: AbortSignal): Promise<void> | void;
};

export type CdpRelayOptions = {
  upstreamUrl: string;
  worker: RawInputWorker;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  directFallback?: { keyboard?: boolean; mouse?: boolean; touch?: boolean };
};

export type CdpRelay = {
  url: string;
  port: number;
  pendingCount(): number;
  stop(): Promise<void>;
};

type Message = JsonRecord & {
  id?: number | string;
  method?: string;
  params?: JsonRecord;
  sessionId?: string;
};

type Pending = {
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type Operation = {
  controller: AbortController;
  sessionId?: string;
  targetId?: string;
  client: Client;
  id: number | string;
  acked: boolean;
  cancelReason?: "lifecycle" | "timeout";
};

type Client = {
  socket: Socket;
  upstream?: WebSocket;
  connectAbort?: AbortController;
  ready: Promise<void>;
  closed: boolean;
  inputTail: Promise<void>;
  pending: Map<number | string, Pending>;
  pendingAttach: Map<number | string, string>;
  sessionTargets: Map<string, string>;
  targetSessions: Map<string, Set<string>>;
  operations: Set<Operation>;
  internalIds: Set<number>;
  tombstones: Map<number, ReturnType<typeof setTimeout>>;
};

const MAX_INTERNAL_TOMBSTONES = 64;
const INTERNAL_TOMBSTONE_MS = 1_000;

const isId = (value: unknown): value is number | string =>
  (typeof value === "number" && Number.isSafeInteger(value)) ||
  (typeof value === "string" && value.length > 0 && value.length <= 256);

const frameBytes = (frame: Frame): number => {
  if (typeof frame === "string") return Buffer.byteLength(frame, "utf8");
  if (Array.isArray(frame))
    return frame.reduce((size, part) => size + part.byteLength, 0);
  return frame.byteLength;
};

const validate = (frame: Frame): Message => {
  if (typeof frame !== "string")
    throw new Error("binary CDP frames are unsupported");
  if (frameBytes(frame) > MAX_CDP_MESSAGE_BYTES)
    throw new Error("CDP message is too large");
  let value: unknown;
  try {
    value = JSON.parse(frame);
  } catch {
    throw new Error("CDP message is not JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("CDP message is invalid");
  const message = value as JsonRecord;
  if (!("id" in message) && !("method" in message))
    throw new Error("CDP message is missing id and method");
  if ("id" in message && !isId(message.id))
    throw new Error("CDP id is invalid");
  if (
    "method" in message &&
    (typeof message.method !== "string" ||
      message.method.length === 0 ||
      message.method.length > 256)
  )
    throw new Error("CDP method is invalid");
  if (
    "params" in message &&
    (!message.params ||
      typeof message.params !== "object" ||
      Array.isArray(message.params))
  )
    throw new Error("CDP params are invalid");
  if (
    "sessionId" in message &&
    (typeof message.sessionId !== "string" ||
      message.sessionId.length === 0 ||
      message.sessionId.length > 256)
  )
    throw new Error("CDP session is invalid");
  return message as Message;
};

const parseTimeout = (
  envValue: string | undefined,
  explicit: number | undefined,
): number => {
  const raw = explicit === undefined ? envValue?.trim() : String(explicit);
  if (!raw) return DEFAULT_CDP_TIMEOUT_MS;
  if (!/^\d+$/.test(raw))
    throw new RangeError("BROWSERLOGIN_CDP_TIMEOUT is invalid");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CDP_TIMEOUT_MS)
    throw new RangeError("BROWSERLOGIN_CDP_TIMEOUT is out of bounds");
  return value;
};

const isInternalId = (client: Client, value: unknown): value is number =>
  typeof value === "number" && client.internalIds.has(value);

const response = (id: number | string, sessionId?: string): JsonRecord => ({
  id,
  ...(sessionId ? { sessionId } : {}),
  result: {},
});

const errorResponse = (
  id: number | string,
  sessionId?: string,
): JsonRecord => ({
  id,
  ...(sessionId ? { sessionId } : {}),
  error: { code: -32000, message: "CDP relay operation failed" },
});

const send = (socket: Socket, value: JsonRecord): void => {
  if (socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(value));
  } catch {
    socket.close(1011, "relay send failed");
  }
};

const addMapping = (
  client: Client,
  sessionId: string,
  targetId: string,
): void => {
  client.sessionTargets.set(sessionId, targetId);
  const sessions = client.targetSessions.get(targetId) ?? new Set<string>();
  sessions.add(sessionId);
  client.targetSessions.set(targetId, sessions);
};

const removeMapping = (client: Client, sessionId: string): void => {
  const targetId = client.sessionTargets.get(sessionId);
  client.sessionTargets.delete(sessionId);
  if (!targetId) return;
  const sessions = client.targetSessions.get(targetId);
  sessions?.delete(sessionId);
  if (sessions?.size === 0) client.targetSessions.delete(targetId);
};

const cancel = (operation: Operation): void => {
  if (!operation.acked) {
    operation.cancelReason = "lifecycle";
    operation.controller.abort();
  }
};

const cancelSessionOperations = (client: Client, sessionId: string): void => {
  for (const operation of client.operations)
    if (operation.sessionId === sessionId) cancel(operation);
};

const cancelSession = (client: Client, sessionId: string): void => {
  cancelSessionOperations(client, sessionId);
  removeMapping(client, sessionId);
};

const cancelTarget = (client: Client, targetId: string): void => {
  for (const operation of client.operations)
    if (operation.targetId === targetId) cancel(operation);
  for (const sessionId of client.targetSessions.get(targetId) ?? [])
    removeMapping(client, sessionId);
};

const updateMappings = (client: Client, message: Message): void => {
  if (message.id !== undefined) {
    const targetId = client.pendingAttach.get(message.id);
    if (targetId) {
      client.pendingAttach.delete(message.id);
      const result = message.result;
      const sessionId =
        result && typeof result === "object" && !Array.isArray(result)
          ? (result as JsonRecord).sessionId
          : undefined;
      if (typeof sessionId === "string")
        addMapping(client, sessionId, targetId);
    }
  }
  if (message.method === "Target.attachedToTarget") {
    const info = message.params?.targetInfo;
    const targetId =
      info && typeof info === "object" && !Array.isArray(info)
        ? (info as JsonRecord).targetId
        : undefined;
    const sessionId = message.params?.sessionId;
    if (typeof targetId === "string" && typeof sessionId === "string")
      addMapping(client, sessionId, targetId);
  }
  if (
    message.method === "Target.detachedFromTarget" &&
    typeof message.params?.sessionId === "string"
  )
    cancelSession(client, message.params.sessionId);
  if (
    message.method === "Target.targetDestroyed" &&
    typeof message.params?.targetId === "string"
  )
    cancelTarget(client, message.params.targetId);
  if (message.method === "Target.targetInfoChanged") {
    return;
  }
  if (message.method === "Page.frameNavigated" && message.sessionId)
    cancelSessionOperations(client, message.sessionId);
};

const closeClient = (client: Client, code = 1000): void => {
  if (client.closed) return;
  client.closed = true;
  for (const pending of client.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error("CDP relay connection closed"));
  }
  client.pending.clear();
  for (const timer of client.tombstones.values()) clearTimeout(timer);
  client.tombstones.clear();
  client.internalIds.clear();
  for (const operation of client.operations) cancel(operation);
  client.pendingAttach.clear();
  client.sessionTargets.clear();
  client.targetSessions.clear();
  client.connectAbort?.abort();
  client.upstream?.close(code);
  client.socket.close(code);
};

const addTombstone = (client: Client, id: number): void => {
  const previous = client.tombstones.get(id);
  if (previous !== undefined) clearTimeout(previous);
  const timer = setTimeout(() => {
    client.tombstones.delete(id);
    client.internalIds.delete(id);
  }, INTERNAL_TOMBSTONE_MS);
  client.tombstones.set(id, timer);
  while (client.tombstones.size > MAX_INTERNAL_TOMBSTONES) {
    const oldest = client.tombstones.keys().next().value;
    if (typeof oldest !== "number") break;
    const oldestTimer = client.tombstones.get(oldest);
    if (oldestTimer !== undefined) clearTimeout(oldestTimer);
    client.tombstones.delete(oldest);
    client.internalIds.delete(oldest);
  }
};

const connect = (
  url: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      maxPayload: MAX_CDP_MESSAGE_BYTES,
    });
    const abort = () => {
      socket.terminate();
      reject(new Error("CDP upstream connection cancelled"));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("CDP upstream connection timed out"));
    }, timeoutMs);
    socket.once("open", () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve(socket);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new Error("CDP upstream connection failed"));
    });
  });

const sendAndWait = (
  client: Client,
  message: JsonRecord,
  timeoutMs: number,
): Promise<Message> => {
  const id = message.id;
  if (!client.upstream || !isId(id) || client.closed)
    return Promise.reject(new Error("CDP upstream is unavailable"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.pending.delete(id);
      if (isInternalId(client, id)) addTombstone(client, id);
      reject(new Error("CDP upstream response timed out"));
    }, timeoutMs);
    client.pending.set(id, { resolve, reject, timer });
    try {
      client.upstream?.send(JSON.stringify(message));
    } catch {
      clearTimeout(timer);
      client.pending.delete(id);
      reject(new Error("CDP upstream send failed"));
    }
  });
};

const fallbackAllowed = (
  method: string,
  configured: NonNullable<CdpRelayOptions["directFallback"]>,
): boolean => {
  if (method === "Input.dispatchKeyEvent" || method === "Input.insertText")
    return configured.keyboard ?? true;
  if (method === "Input.dispatchMouseEvent") return configured.mouse ?? false;
  return configured.touch ?? false;
};

const runInput = async (
  client: Client,
  message: Message,
  options: CdpRelayOptions,
  timeoutMs: number,
): Promise<void> => {
  if (
    client.closed ||
    message.id === undefined ||
    !message.method ||
    !INTERCEPTED_INPUT_METHODS.has(message.method)
  )
    return;
  const operation: Operation = {
    controller: new AbortController(),
    sessionId: message.sessionId,
    targetId: message.sessionId
      ? client.sessionTargets.get(message.sessionId)
      : undefined,
    client,
    id: message.id,
    acked: false,
  };
  client.operations.add(operation);
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(
        options.worker.execute(
          {
            method: message.method as RawInput["method"],
            params: message.params ?? {},
            ...(message.sessionId ? { sessionId: message.sessionId } : {}),
            ...(operation.targetId ? { targetId: operation.targetId } : {}),
          },
          operation.controller.signal,
        ),
      ),
      new Promise<never>((_, reject) => {
        if (operation.controller.signal.aborted) {
          reject(new Error("CDP input was cancelled"));
          return;
        }
        operation.controller.signal.addEventListener(
          "abort",
          () => reject(new Error("CDP input was cancelled")),
          { once: true },
        );
      }),
      new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          operation.cancelReason = "timeout";
          operation.controller.abort();
          reject(new Error("CDP input timed out"));
        }, timeoutMs);
      }),
    ]);
    if (!operation.acked) {
      operation.acked = true;
      send(client.socket, response(message.id, message.sessionId));
    }
  } catch {
    if (
      operation.controller.signal.aborted &&
      operation.cancelReason === "lifecycle"
    ) {
      operation.acked = true;
      send(client.socket, response(message.id, message.sessionId));
    } else if (fallbackAllowed(message.method, options.directFallback ?? {})) {
      const fallbackId = internalId(client);
      const upstreamResponse = await sendAndWait(
        client,
        {
          id: fallbackId,
          method: message.method,
          params: message.params ?? {},
          ...(message.sessionId ? { sessionId: message.sessionId } : {}),
        },
        timeoutMs,
      ).catch(() => undefined);
      operation.acked = true;
      send(
        client.socket,
        !upstreamResponse || upstreamResponse.error
          ? errorResponse(message.id, message.sessionId)
          : response(message.id, message.sessionId),
      );
    } else {
      operation.acked = true;
      send(client.socket, errorResponse(message.id, message.sessionId));
    }
  } finally {
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    client.operations.delete(operation);
  }
};

const handleClientMessage = async (
  client: Client,
  frame: Frame,
  options: CdpRelayOptions,
  timeoutMs: number,
): Promise<void> => {
  try {
    await client.ready;
  } catch {
    return;
  }
  if (client.closed || !client.upstream) return;
  let message: Message;
  try {
    message = validate(frame);
  } catch {
    closeClient(client, 1003);
    return;
  }
  if (
    message.method &&
    INTERCEPTED_INPUT_METHODS.has(message.method) &&
    message.id !== undefined
  ) {
    client.inputTail = client.inputTail
      .then(() => runInput(client, message, options, timeoutMs))
      .catch(() => closeClient(client, 1011));
    return;
  }
  if (message.method === "Target.attachToTarget" && message.id !== undefined) {
    const targetId = message.params?.targetId;
    if (typeof targetId === "string")
      client.pendingAttach.set(message.id, targetId);
  }
  if (client.upstream.readyState === WebSocket.OPEN) {
    try {
      client.upstream.send(JSON.stringify(message));
    } catch {
      closeClient(client, 1011);
    }
  }
};

const handleUpstreamMessage = (client: Client, frame: Frame): void => {
  let message: Message;
  try {
    message = validate(frame);
  } catch {
    closeClient(client, 1003);
    return;
  }
  updateMappings(client, message);
  if (message.id !== undefined && client.pending.has(message.id)) {
    const pending = client.pending.get(message.id);
    if (pending) {
      clearTimeout(pending.timer);
      client.pending.delete(message.id);
      if (isInternalId(client, message.id))
        client.internalIds.delete(message.id);
      pending.resolve(message);
    }
    return;
  }
  if (isInternalId(client, message.id)) {
    client.internalIds.delete(message.id);
    const tombstoneTimer = client.tombstones.get(message.id);
    if (tombstoneTimer !== undefined) {
      clearTimeout(tombstoneTimer);
      client.tombstones.delete(message.id);
    }
    return;
  }
  send(client.socket, message);
};

const upstreamUrl = (value: string): string => {
  const url = new URL(value);
  if (url.protocol !== "ws:" && url.protocol !== "wss:")
    throw new TypeError("CDP upstream must use ws or wss");
  return url.toString();
};

const newClient = (): Client => ({
  socket: undefined as unknown as Socket,
  ready: Promise.resolve(),
  closed: false,
  inputTail: Promise.resolve(),
  pending: new Map(),
  pendingAttach: new Map(),
  sessionTargets: new Map(),
  targetSessions: new Map(),
  operations: new Set(),
  internalIds: new Set(),
  tombstones: new Map(),
});

const internalId = (client: Client): number => {
  let id = -1 - (randomBytes(4).readUInt32BE(0) & 0x3fffffff);
  while (client.internalIds.has(id) || client.pending.has(id))
    id = -1 - (randomBytes(4).readUInt32BE(0) & 0x3fffffff);
  client.internalIds.add(id);
  return id;
};

export const startCdpRelay = async (
  options: CdpRelayOptions,
): Promise<CdpRelay> => {
  const targetUrl = upstreamUrl(options.upstreamUrl);
  const timeoutMs = parseTimeout(
    (options.env ?? process.env).BROWSERLOGIN_CDP_TIMEOUT,
    options.timeoutMs,
  );
  const token = randomBytes(24).toString("base64url");
  let used = false;
  let active: Client | undefined;
  const clients = new Set<Client>();
  const states = new WeakMap<WebSocket, Client>();
  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_CDP_MESSAGE_BYTES,
  });
  websocketServer.on("error", () => undefined);
  const server: Server = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  websocketServer.on("connection", (socket: WebSocket) => {
    const client = states.get(socket);
    if (!client) return socket.close(1011);
    client.socket = socket;
    active = client;
    clients.add(client);
    const connectAbort = new AbortController();
    client.connectAbort = connectAbort;
    client.ready = connect(targetUrl, timeoutMs, connectAbort.signal)
      .then(async (upstream) => {
        if (client.closed) {
          upstream.terminate();
          return;
        }
        client.upstream = upstream;
        upstream.on("message", (frame: RawData, isBinary: boolean) =>
          handleUpstreamMessage(client, isBinary ? frame : frame.toString()),
        );
        upstream.on("close", () => closeClient(client));
        upstream.on("error", () => closeClient(client, 1011));
        const id = internalId(client);
        const autoAttach = await sendAndWait(
          client,
          {
            id,
            method: "Target.setAutoAttach",
            params: {
              autoAttach: true,
              waitForDebuggerOnStart: false,
              flatten: true,
            },
          },
          timeoutMs,
        );
        if (
          autoAttach.error ||
          !autoAttach.result ||
          typeof autoAttach.result !== "object" ||
          Array.isArray(autoAttach.result)
        )
          throw new Error("CDP auto-attach failed");
      })
      .catch((error) => {
        closeClient(client, 1011);
        throw error;
      })
      .finally(() => {
        client.connectAbort = undefined;
      });
    void client.ready.catch(() => undefined);
    socket.on("message", (frame: RawData, isBinary: boolean) => {
      if (frameBytes(frame) > MAX_CDP_MESSAGE_BYTES) {
        closeClient(client, 1009);
        return;
      }
      void handleClientMessage(
        client,
        isBinary ? frame : frame.toString(),
        options,
        timeoutMs,
      );
    });
    socket.on("close", () => {
      closeClient(client);
      clients.delete(client);
      if (active === client) active = undefined;
    });
    socket.on("error", () => closeClient(client, 1011));
  });
  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (
      pathname !== `/${token}` ||
      used ||
      active ||
      request.headers.upgrade?.toLowerCase() !== "websocket"
    ) {
      socket.destroy();
      return;
    }
    used = true;
    const client = newClient();
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      states.set(websocket, client);
      websocketServer.emit("connection", websocket, request);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("CDP relay port is unavailable");
  return {
    url: `ws://127.0.0.1:${address.port}/${token}`,
    port: address.port,
    pendingCount: () =>
      [...clients].reduce(
        (count, client) =>
          count +
          client.operations.size +
          client.pending.size +
          client.internalIds.size +
          client.tombstones.size,
        0,
      ),
    async stop() {
      const activeClients = [...clients];
      for (const client of activeClients) closeClient(client, 1001);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 100);
        websocketServer.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      for (const client of activeClients) {
        client.socket.terminate();
        client.upstream?.terminate();
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 100);
        server.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      clients.clear();
      active = undefined;
    },
  };
};
