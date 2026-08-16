import { WebSocket } from "ws";

import type { CdpSender } from "./types";

export const MAX_DIRECT_CDP_MESSAGE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_DIRECT_CDP_TIMEOUT_MS = 10_000;

type Json = Record<string, unknown>;
type Pending = {
  resolve: (value: Json) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type DirectCdpOptions = {
  timeoutMs?: number;
  maxMessageBytes?: number;
  socketFactory?: (url: string, maxPayload: number) => WebSocket;
};

export class DirectCdpError extends Error {
  constructor(public readonly stale = false) {
    super("direct CDP request failed");
    this.name = "DirectCdpError";
  }
}

export class DirectCdpSender implements CdpSender {
  private socket?: WebSocket;
  private connecting?: Promise<void>;
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly targets = new Map<string, string>();
  private defaultTarget?: string;
  private closed = false;
  private readonly timeoutMs: number;
  private readonly maxMessageBytes: number;
  private readonly socketFactory: (
    url: string,
    maxPayload: number,
  ) => WebSocket;

  constructor(
    private readonly browserWsUrl: string,
    options: DirectCdpOptions = {},
  ) {
    this.timeoutMs = Math.max(
      1,
      Math.min(options.timeoutMs ?? DEFAULT_DIRECT_CDP_TIMEOUT_MS, 120_000),
    );
    this.maxMessageBytes = Math.max(
      1024,
      Math.min(
        options.maxMessageBytes ?? MAX_DIRECT_CDP_MESSAGE_BYTES,
        MAX_DIRECT_CDP_MESSAGE_BYTES,
      ),
    );
    this.socketFactory =
      options.socketFactory ??
      ((url, maxPayload) => new WebSocket(url, { maxPayload }));
  }

  async send(method: string, params: Json, sessionId?: string): Promise<void> {
    await this.request(method, params, sessionId);
  }

  async request(
    method: string,
    params: Json = {},
    sessionId?: string,
  ): Promise<Json> {
    if (this.closed) throw new DirectCdpError();
    await this.connect();
    const selectedSession = sessionId ?? (await this.ensureTargetSession());
    try {
      return await this.requestOnce(method, params, selectedSession);
    } catch (error) {
      if (!isStaleSession(error) || !selectedSession)
        throw new DirectCdpError();
      this.invalidateSession(selectedSession);
      const fresh = await this.ensureTargetSession();
      return this.requestOnce(method, params, fresh);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new DirectCdpError());
      this.pending.delete(id);
    }
    this.targets.clear();
    this.defaultTarget = undefined;
    const socket = this.socket;
    this.socket = undefined;
    this.connecting = undefined;
    if (!socket) return;
    await new Promise<void>((resolve) => {
      let finished = false;
      const done = () => {
        if (!finished) {
          finished = true;
          resolve();
        }
      };
      socket.once("close", done);
      socket.once("error", done);
      socket.close();
      setTimeout(() => {
        socket.terminate();
        done();
      }, 1_000);
    });
  }

  private async connect(): Promise<void> {
    if (this.socket) return;
    if (!this.connecting) {
      this.connecting = new Promise<void>((resolve, reject) => {
        let socket: WebSocket;
        try {
          socket = this.socketFactory(this.browserWsUrl, this.maxMessageBytes);
        } catch {
          reject(new DirectCdpError());
          return;
        }
        this.socket = socket;
        const fail = () => {
          this.socket = undefined;
          reject(new DirectCdpError());
        };
        socket.once("open", () => resolve());
        socket.once("error", fail);
        socket.on("message", (data: Buffer | ArrayBuffer | Buffer[]) =>
          this.receive(data),
        );
        socket.on("close", () => this.invalidateConnection());
      }).finally(() => {
        this.connecting = undefined;
      });
    }
    await this.connecting;
  }

  private requestOnce(
    method: string,
    params: Json,
    sessionId?: string,
  ): Promise<Json> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new DirectCdpError());
    const id = ++this.nextId;
    return new Promise<Json>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new DirectCdpError());
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        socket.send(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        );
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new DirectCdpError());
      }
    });
  }

  private async ensureTargetSession(): Promise<string | undefined> {
    if (this.defaultTarget && this.targets.has(this.defaultTarget))
      return this.targets.get(this.defaultTarget);
    if (this.defaultTarget) {
      const sessionId = await this.attach(this.defaultTarget);
      this.targets.set(this.defaultTarget, sessionId);
      return sessionId;
    }
    const result = await this.requestOnce("Target.getTargets", {});
    const infos = Array.isArray(result.targetInfos) ? result.targetInfos : [];
    const target = infos.find((item) => {
      const info = asJson(item);
      return (
        info?.type === "page" &&
        typeof info.targetId === "string" &&
        !(typeof info.url === "string" && info.url.startsWith("chrome"))
      );
    });
    const targetId = asJson(target)?.targetId;
    if (typeof targetId !== "string") throw new DirectCdpError();
    this.defaultTarget = targetId;
    const sessionId = await this.attach(targetId);
    this.targets.set(targetId, sessionId);
    return sessionId;
  }

  private async attach(targetId: string): Promise<string> {
    const attached = await this.requestOnce("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const sessionId = asJson(attached)?.sessionId;
    if (typeof sessionId !== "string") throw new DirectCdpError();
    return sessionId;
  }

  private receive(data: Buffer | ArrayBuffer | Buffer[]): void {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as never);
    if (bytes.byteLength > this.maxMessageBytes) {
      this.invalidateConnection();
      return;
    }
    let message: Json;
    try {
      message = JSON.parse(bytes.toString("utf8")) as Json;
    } catch {
      return;
    }
    const id = message.id;
    if (typeof id === "number") {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      const error = asJson(message.error);
      if (error) pending.reject(new DirectCdpError(isStaleError(error)));
      else pending.resolve(asJson(message.result) ?? {});
      return;
    }
    if (message.method === "Target.detachedFromTarget") {
      const sessionId = asJson(message.params)?.sessionId;
      if (typeof sessionId === "string") {
        this.invalidateSession(sessionId);
        if (!this.targets.size) this.defaultTarget = undefined;
      }
    }
  }

  private invalidateSession(sessionId: string): void {
    for (const [target, session] of this.targets)
      if (session === sessionId) {
        this.targets.delete(target);
      }
  }

  private invalidateConnection(): void {
    this.socket = undefined;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new DirectCdpError());
      this.pending.delete(id);
    }
    this.targets.clear();
    this.defaultTarget = undefined;
  }
}

function asJson(value: unknown): Json | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function isStaleSession(error: unknown): boolean {
  return error instanceof DirectCdpError && error.stale;
}

function isStaleError(error: Json): boolean {
  const message =
    typeof error.message === "string" ? error.message.toLowerCase() : "";
  return [
    "session not found",
    "no session",
    "target closed",
    "cannot find target",
    "detached",
  ].some((marker) => message.includes(marker));
}
