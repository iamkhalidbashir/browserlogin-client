import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from "node:net";

export type Socks5Upstream = {
  protocol?: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
};

export class SocksRelayError extends Error {
  readonly diagnostic?: string;

  constructor(message = "SOCKS relay request failed", diagnostic?: string) {
    super(message);
    this.diagnostic = diagnostic;
    this.name = "SocksRelayError";
  }
}

type RelayOptions = {
  handshakeTimeout?: number;
  connectTimeout?: number;
  idleTimeout?: number;
  maxConnections?: number;
  onDiagnostic?: (phase: SocksRelayPhase, detail?: string) => void;
};

export type SocksRelayPhase =
  | "client-greeting"
  | "client-request"
  | "upstream-connect"
  | "upstream-method"
  | "upstream-authentication"
  | "upstream-request"
  | "tunnel";

const INVALID = "SOCKS relay request failed";
const SOCKS_FAILURE = Buffer.from([5, 1, 0, 1, 0, 0, 0, 0, 0, 0]);

function credential(value: string | undefined): Buffer {
  if (value === undefined) return Buffer.alloc(0);
  const encoded = Buffer.from(value, "utf8");
  if (
    encoded.length > 255 ||
    encoded.some((byte) => byte === 0 || byte < 0x20 || byte === 0x7f)
  ) {
    throw new SocksRelayError(INVALID);
  }
  return encoded;
}

async function readExact(
  socket: Socket,
  size: number,
  deadline: number,
): Promise<Buffer> {
  if (size < 0 || size > 65535) throw new SocksRelayError(INVALID);
  const chunks: Buffer[] = [];
  let received = 0;
  while (received < size) {
    const chunk = await new Promise<Buffer>((resolve, reject) => {
      const onData = (data: Buffer) => {
        cleanup();
        resolve(data);
      };
      const onEnd = () => {
        cleanup();
        reject(new SocksRelayError(INVALID, received ? `early-disconnect bytes=${received}` : "no-bytes"));
      };
      const onError = () => {
        cleanup();
        reject(
          new SocksRelayError(
            INVALID,
            received ? `early-disconnect bytes=${received}` : "no-bytes",
          ),
        );
      };
      const timer = setTimeout(
        () => {
          cleanup();
          reject(new SocksRelayError(INVALID, `timeout bytes=${received}`));
        },
        Math.max(1, deadline - Date.now()),
      );
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("data", onData);
        socket.off("end", onEnd);
        socket.off("error", onError);
      };
      socket.once("data", onData);
      socket.once("end", onEnd);
      socket.once("error", onError);
    });
    chunks.push(chunk);
    received += chunk.length;
  }
  const data = Buffer.concat(chunks);
  if (data.length === size) return data;
  const remainder = data.subarray(size);
  if (remainder.length) socket.unshift(remainder);
  return data.subarray(0, size);
}

async function readAddress(
  socket: Socket,
  atyp: number,
  deadline: number,
): Promise<Buffer> {
  if (atyp === 1) return readExact(socket, 4, deadline);
  if (atyp === 4) return readExact(socket, 16, deadline);
  if (atyp === 3) {
    const length = (await readExact(socket, 1, deadline))[0];
    if (!length) throw new SocksRelayError(INVALID);
    return Buffer.concat([
      Buffer.from([length]),
      await readExact(socket, length, deadline),
    ]);
  }
  throw new SocksRelayError(INVALID);
}

function frameAddress(address: Buffer): Buffer {
  return address;
}

async function sendFailure(socket: Socket): Promise<void> {
  if (!socket.writable || socket.destroyed) return;
  socket.end(SOCKS_FAILURE);
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 100);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export class Socks5Relay {
  private readonly username: Buffer;
  private readonly password: Buffer;
  private readonly options: Required<RelayOptions>;
  private readonly sockets = new Set<Socket>();
  private readonly workers = new Set<Promise<void>>();
  private server: Server | null = null;
  private port: number | null = null;
  private stopping: Promise<void> | null = null;

  constructor(
    private readonly upstream: Socks5Upstream,
    options: RelayOptions = {},
  ) {
    if (
      !upstream.host ||
      !Number.isInteger(upstream.port) ||
      upstream.port < 1 ||
      upstream.port > 65535
    )
      throw new SocksRelayError(INVALID);
    if (upstream.username === undefined && upstream.password === undefined)
      throw new SocksRelayError(INVALID);
    this.username = credential(upstream.username);
    this.password = credential(upstream.password);
    this.options = {
      handshakeTimeout: options.handshakeTimeout ?? 10_000,
      connectTimeout: options.connectTimeout ?? 10_000,
      idleTimeout: options.idleTimeout ?? 600_000,
      maxConnections: options.maxConnections ?? 128,
      onDiagnostic: options.onDiagnostic ?? (() => undefined),
    };
    if (this.options.maxConnections < 1)
      throw new RangeError("maxConnections must be positive");
  }

  get proxyUrl(): string {
    if (this.port === null)
      throw new SocksRelayError("SOCKS relay is not running");
    return `socks5://127.0.0.1:${this.port}`;
  }

  get activeCount(): number {
    return this.workers.size;
  }

  async start(): Promise<this> {
    if (this.server)
      throw new SocksRelayError("SOCKS relay is already running");
    const server = createServer({ allowHalfOpen: true }, (client) => {
      if (this.workers.size >= this.options.maxConnections) {
        client.destroy();
        return;
      }
      this.sockets.add(client);
      const worker = this.handleClient(client).finally(() => {
        this.workers.delete(worker);
        this.sockets.delete(client);
      });
      this.workers.add(worker);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(
          new SocksRelayError(
            error.message.includes("EADDR") ? INVALID : INVALID,
          ),
        );
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({ host: "127.0.0.1", port: 0 });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await this.close();
      throw new SocksRelayError(INVALID);
    }
    this.port = address.port;
    return this;
  }

  async close(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      const server = this.server;
      this.server = null;
      this.port = null;
      for (const socket of this.sockets) socket.destroy();
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      await Promise.allSettled([...this.workers]);
      this.stopping = null;
    })();
    return this.stopping;
  }

  private async handleClient(client: Socket): Promise<void> {
    let upstream: Socket | undefined;
    const deadline = Date.now() + this.options.handshakeTimeout;
    let protocolReady = false;
    let phase: SocksRelayPhase = "client-greeting";
    try {
      const greeting = await readExact(client, 2, deadline);
      if (greeting[0] !== 5)
        throw new SocksRelayError(INVALID, `version=${greeting[0]}`);
      const methods = await readExact(client, greeting[1], deadline);
      if (!methods.includes(0)) {
        this.options.onDiagnostic?.(phase, `methods=${methods.toString("hex")}`);
        client.end(Buffer.from([5, 255]));
        return;
      }
      client.write(Buffer.from([5, 0]));
      protocolReady = true;
      phase = "client-request";
      const request = await readExact(client, 4, deadline);
      if (request[0] !== 5 || request[2] !== 0)
        throw new SocksRelayError(INVALID);
      const address = await readAddress(client, request[3], deadline);
      const port = await readExact(client, 2, deadline);
      if (request[1] !== 1) {
        client.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0]));
        return;
      }

      phase = "upstream-connect";
      upstream = await this.connectUpstream();
      this.sockets.add(upstream);
      upstream.setTimeout(this.options.handshakeTimeout, () =>
        upstream?.destroy(),
      );
      phase = "upstream-method";
      upstream.write(Buffer.from([5, 1, 2]));
      if (!(await readExact(upstream, 2, deadline)).equals(Buffer.from([5, 2])))
        throw new SocksRelayError(INVALID);
      phase = "upstream-authentication";
      upstream.write(
        Buffer.concat([
          Buffer.from([1, this.username.length]),
          this.username,
          Buffer.from([this.password.length]),
          this.password,
        ]),
      );
      if (!(await readExact(upstream, 2, deadline)).equals(Buffer.from([1, 0])))
        throw new SocksRelayError(INVALID);
      phase = "upstream-request";
      upstream.write(Buffer.concat([request, frameAddress(address), port]));
      const replyHead = await readExact(upstream, 4, deadline);
      if (replyHead[0] !== 5 || replyHead[2] !== 0 || replyHead[1] > 8)
        throw new SocksRelayError(INVALID);
      const replyAddress = await readAddress(upstream, replyHead[3], deadline);
      const replyPort = await readExact(upstream, 2, deadline);
      client.write(
        Buffer.concat([replyHead, frameAddress(replyAddress), replyPort]),
      );
      if (replyHead[1] !== 0) {
        this.options.onDiagnostic?.(phase);
        return;
      }
      client.setTimeout(this.options.idleTimeout, () => {
        client.destroy();
        upstream?.destroy();
      });
      upstream.setTimeout(this.options.idleTimeout, () => {
        client.destroy();
        upstream?.destroy();
      });
      phase = "tunnel";
      await this.tunnel(client, upstream);
    } catch (error) {
      this.options.onDiagnostic?.(
        phase,
        error instanceof SocksRelayError ? error.diagnostic : undefined,
      );
      if (protocolReady) await sendFailure(client);
    } finally {
      if (upstream) this.sockets.delete(upstream);
      upstream?.destroy();
      client.destroy();
    }
  }

  private connectUpstream(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({
        host: this.upstream.host,
        port: this.upstream.port,
      });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new SocksRelayError(INVALID));
      }, this.options.connectTimeout);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once("error", () => {
        clearTimeout(timer);
        reject(new SocksRelayError(INVALID));
      });
    });
  }

  private async tunnel(client: Socket, upstream: Socket): Promise<void> {
    await new Promise<void>((resolve) => {
      let clientEnded = false;
      let upstreamEnded = false;
      let settled = false;
      const finish = () => {
        if (!settled && clientEnded && upstreamEnded) {
          settled = true;
          resolve();
        }
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        client.destroy();
        upstream.destroy();
        resolve();
      };
      client.once("end", () => {
        clientEnded = true;
        upstream.end();
        finish();
      });
      upstream.once("end", () => {
        upstreamEnded = true;
        client.end();
        finish();
      });
      client.once("close", () => {
        if (!clientEnded || !upstreamEnded) fail();
        else finish();
      });
      upstream.once("close", () => {
        if (!clientEnded || !upstreamEnded) fail();
        else finish();
      });
      client.once("error", fail);
      upstream.once("error", fail);
      client.pipe(upstream, { end: false });
      upstream.pipe(client, { end: false });
    });
  }
}
