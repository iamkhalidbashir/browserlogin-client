import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import {
  Socks5Relay,
  SocksRelayError,
} from "../../src/core/proxy/socks-relay.js";

const relays: Socks5Relay[] = [];
const servers: Server[] = [];
const failure = Buffer.from([5, 1, 0, 1, 0, 0, 0, 0, 0, 0]);

afterEach(async () => {
  await Promise.all(relays.splice(0).map((relay) => relay.close()));
  await Promise.all(
    servers.splice(0).map(async (server) => {
      if (!server.listening) return;
      server.close();
      await once(server, "close");
    }),
  );
});

async function listen(server: Server): Promise<number> {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as { port: number }).port;
}

function connect(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () =>
      resolve(socket),
    );
    socket.once("error", reject);
  });
}

function waitForSocketEvent(
  socket: Socket,
  event: "close" | "data",
  timeoutMs = 2_000,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeListener(event, onEvent);
      reject(new Error(`timed out waiting for socket ${event}`));
    }, timeoutMs);
    const onEvent = (...args: unknown[]) => {
      clearTimeout(timer);
      resolve(args);
    };
    socket.once(event, onEvent);
  });
}

async function echoTarget(): Promise<number> {
  return listen(
    createServer({ allowHalfOpen: true }, (socket) => {
      socket.on("data", (data) =>
        socket.write(Buffer.concat([Buffer.from("echo:"), data])),
      );
      socket.on("end", () => socket.end());
    }),
  );
}

async function authenticatedUpstream(
  targetPort: number,
  expectedPassword: string,
  replyCode = 0,
  rejectFirstAuth = false,
  finalResponse?: Buffer,
): Promise<number> {
  let authAttempts = 0;
  return listen(
    createServer({ allowHalfOpen: true }, (socket) => {
      socket.once("data", (greeting) => {
        if (greeting[0] !== 5 || greeting[2] !== 2) return socket.destroy();
        socket.write(Buffer.from([5, 2]));
        socket.once("data", (auth) => {
          const usernameLength = auth[1];
          const passwordLength = auth[2 + usernameLength];
          const password = auth
            .subarray(3 + usernameLength, 3 + usernameLength + passwordLength)
            .toString();
          const accepted =
            password === expectedPassword &&
            !(rejectFirstAuth && authAttempts++ === 0);
          socket.write(Buffer.from([1, accepted ? 0 : 1]));
          if (!accepted) return socket.destroy();
          socket.once("data", (request) => {
            if (request[0] !== 5 || request[1] !== 1) return socket.destroy();
            if (replyCode !== 0)
              return socket.write(
                Buffer.from([5, replyCode, 0, 1, 127, 0, 0, 1, 0, 80]),
              );
            if (finalResponse) {
              socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));
              socket.once("end", () => {
                socket.write(finalResponse);
                socket.end();
              });
              return;
            }
            const target = createConnection({
              host: "127.0.0.1",
              port: targetPort,
            });
            target.once("connect", () => {
              socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));
              socket.pipe(target);
              target.pipe(socket);
            });
            target.once("error", () => socket.destroy());
          });
        });
      });
    }),
  );
}

async function throughRelay(port: number, host = "echo.test"): Promise<Socket> {
  const socket = await connect(port);
  socket.write(Buffer.from([5, 1, 0]));
  expect((await once(socket, "data"))[0][0]).toBe(5);
  const hostBytes = Buffer.from(host);
  socket.write(
    Buffer.concat([
      Buffer.from([5, 1, 0, 3, hostBytes.length]),
      hostBytes,
      Buffer.from([0, 80]),
    ]),
  );
  expect((await once(socket, "data"))[0][0]).toBe(5);
  return socket;
}

describe("authenticated SOCKS5 relay", () => {
  it("roundtrip forwards through authenticated upstream to a TCP echo target", async () => {
    const targetPort = await echoTarget();
    const upstreamPort = await authenticatedUpstream(targetPort, "secret");
    const relay = new Socks5Relay(
      {
        host: "127.0.0.1",
        port: upstreamPort,
        username: "user",
        password: "secret",
      },
      { idleTimeout: 500 },
    );
    relays.push(relay);
    await relay.start();
    const socket = await throughRelay(Number(new URL(relay.proxyUrl).port));
    socket.write(Buffer.from("payload"));
    expect((await once(socket, "data"))[0]).toEqual(
      Buffer.from("echo:payload"),
    );
    socket.end();
  });

  it("forwards final upstream bytes after the client half-closes", async () => {
    const targetPort = await echoTarget();
    const upstreamPort = await authenticatedUpstream(
      targetPort,
      "secret",
      0,
      false,
      Buffer.from("final:request-before-eof"),
    );
    const relay = new Socks5Relay({
      host: "127.0.0.1",
      port: upstreamPort,
      username: "user",
      password: "secret",
    });
    relays.push(relay);
    await relay.start();
    const socket = await throughRelay(Number(new URL(relay.proxyUrl).port));
    socket.end(Buffer.from("request-before-eof"));
    const [data] = await waitForSocketEvent(socket, "data");
    expect(data).toEqual(Buffer.from("final:request-before-eof"));
    await waitForSocketEvent(socket, "close");
    await relay.close();
    expect(relay.activeCount).toBe(0);
  });

  it("supports domain, IPv4, IPv6 framing and half-close", async () => {
    const targetPort = await echoTarget();
    const upstreamPort = await authenticatedUpstream(targetPort, "secret");
    const relay = new Socks5Relay({
      host: "127.0.0.1",
      port: upstreamPort,
      username: "user",
      password: "secret",
    });
    relays.push(relay);
    await relay.start();
    for (const atyp of [3, 1, 4]) {
      const socket = await connect(Number(new URL(relay.proxyUrl).port));
      socket.write(Buffer.from([5, 1, 0]));
      await once(socket, "data");
      const address =
        atyp === 3
          ? Buffer.concat([Buffer.from([4]), Buffer.from("test")])
          : atyp === 1
            ? Buffer.from([127, 0, 0, 1])
            : Buffer.alloc(16, 1);
      socket.write(
        Buffer.concat([
          Buffer.from([5, 1, 0, atyp]),
          address,
          Buffer.from([0, 80]),
        ]),
      );
      expect((await once(socket, "data"))[0][0]).toBe(5);
      socket.write(Buffer.from("x"));
      expect((await once(socket, "data"))[0]).toEqual(Buffer.from("echo:x"));
      socket.end();
    }
  });

  it("returns stable failures and keeps the same listener usable", async () => {
    const targetPort = await echoTarget();
    const upstreamPort = await authenticatedUpstream(
      targetPort,
      "secret",
      0,
      true,
    );
    const relay = new Socks5Relay({
      host: "127.0.0.1",
      port: upstreamPort,
      username: "user",
      password: "secret",
    });
    relays.push(relay);
    await relay.start();
    const port = Number(new URL(relay.proxyUrl).port);
    const wrongClient = await connect(port);
    wrongClient.write(Buffer.from([5, 1, 0]));
    await once(wrongClient, "data");
    wrongClient.write(Buffer.from([5, 1, 0, 3, 4, 101, 99, 104, 111, 0, 80]));
    expect((await once(wrongClient, "data"))[0]).toEqual(failure);
    const udp = await connect(port);
    udp.write(Buffer.from([5, 1, 0]));
    await once(udp, "data");
    udp.write(Buffer.from([5, 3, 0, 1, 0, 0, 0, 0, 0, 0]));
    expect((await once(udp, "data"))[0][1]).toBe(7);
    const malformed = await connect(port);
    malformed.write(Buffer.from([4, 0]));
    await once(malformed, "close");
    const next = await throughRelay(port);
    next.write(Buffer.from("ok"));
    expect((await once(next, "data"))[0]).toEqual(Buffer.from("echo:ok"));
  });

  it("rejects malformed upstream replies and preserves generic errors", async () => {
    const upstreamPort = await listen(
      createServer((socket) => {
        socket.once("data", () => {
          socket.write(Buffer.from([5, 2]));
          socket.once("data", () => {
            socket.write(Buffer.from([1, 0]));
            socket.once("data", () => socket.write(Buffer.from([5, 9, 0, 1])));
          });
        });
      }),
    );
    const relay = new Socks5Relay({
      host: "127.0.0.1",
      port: upstreamPort,
      username: "secret-user",
      password: "secret-pass",
    });
    relays.push(relay);
    await relay.start();
    const client = await connect(Number(new URL(relay.proxyUrl).port));
    client.write(Buffer.from([5, 1, 0]));
    await once(client, "data");
    client.write(Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, 0, 80]));
    expect((await once(client, "data"))[0]).toEqual(failure);
    const logs: string[] = [];
    const errorLog = console.error;
    console.error = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      let thrown: unknown;
      try {
        new Socks5Relay({
          host: "127.0.0.1",
          port: upstreamPort,
          username: "secret-user",
          password: "secret-pass\n",
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(SocksRelayError);
      const text = `${(thrown as Error).message} ${logs.join(" ")}`;
      expect(text).toBe("SOCKS relay request failed ");
      expect(text).not.toContain("secret-user");
      expect(text).not.toContain("secret-pass");
    } finally {
      console.error = errorLog;
    }
  });

  it("handles twenty concurrent connections", async () => {
    const targetPort = await echoTarget();
    const upstreamPort = await authenticatedUpstream(targetPort, "secret");
    const relay = new Socks5Relay({
      host: "127.0.0.1",
      port: upstreamPort,
      username: "user",
      password: "secret",
    });
    relays.push(relay);
    await relay.start();
    const port = Number(new URL(relay.proxyUrl).port);
    const clients = await Promise.all(
      Array.from({ length: 20 }, () => throughRelay(port)),
    );
    await Promise.all(
      clients.map(async (client) => {
        client.write(Buffer.from("x"));
        expect((await once(client, "data"))[0]).toEqual(Buffer.from("echo:x"));
        client.end();
      }),
    );
    expect(relay.activeCount).toBeLessThanOrEqual(20);
  });

  it("closes an idle tunnel after the injected timeout", async () => {
    const targetPort = await echoTarget();
    const upstreamPort = await authenticatedUpstream(targetPort, "secret");
    const relay = new Socks5Relay(
      {
        host: "127.0.0.1",
        port: upstreamPort,
        username: "user",
        password: "secret",
      },
      { idleTimeout: 25 },
    );
    relays.push(relay);
    await relay.start();
    const socket = await throughRelay(Number(new URL(relay.proxyUrl).port));
    await once(socket, "close");
    for (
      let attempt = 0;
      relay.activeCount !== 0 && attempt < 20;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(relay.activeCount).toBe(0);
  });
});
