import { createConnection, createServer, type Server, type Socket } from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { routeProxy } from "../../src/core/proxy/routing.js";
import { Socks5Relay } from "../../src/core/proxy/socks-relay.js";

const relays: Socks5Relay[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(relays.splice(0).map((relay) => relay.close()));
  await Promise.all(servers.splice(0).map(async (server) => { server.close(); await once(server, "close"); }));
});

function listen(server: Server): Promise<number> {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  return once(server, "listening").then(() => (server.address() as { port: number }).port);
}

function packet(parts: number[]): Buffer { return Buffer.from(parts); }

async function upstreamSocks(echo: (socket: Socket) => void, credentials = true, requests: Buffer[] = [], expectedPassword = "secret"): Promise<number> {
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    socket.once("data", (greeting) => {
      expect(greeting.subarray(0, 3)).toEqual(packet([5, 1, 2]));
      socket.write(credentials ? packet([5, 2]) : packet([5, 0]));
      socket.once("data", (auth) => {
        if (credentials) {
          expect(auth[0]).toBe(1);
          const usernameLength = auth[1];
          const passwordLength = auth[2 + usernameLength];
          const password = auth.subarray(3 + usernameLength, 3 + usernameLength + passwordLength).toString();
          socket.write(packet([1, password === expectedPassword ? 0 : 1]));
          if (password !== expectedPassword) { socket.destroy(); return; }
        }
        socket.once("data", (request) => {
          expect(request[0]).toBe(5);
          requests.push(request);
          socket.write(packet([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));
          echo(socket);
          socket.once("end", () => socket.end());
        });
      });
    });
  });
  return listen(server);
}

function connect(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => resolve(socket));
    socket.once("error", reject);
  });
}

async function connectThroughRelay(relayPort: number, target: Buffer): Promise<Socket> {
  const socket = await connect(relayPort);
  socket.write(packet([5, 1, 0]));
  expect((await once(socket, "data"))[0]).toEqual(packet([5, 0]));
  const atyp = target.length === 4 ? 1 : target.length === 16 ? 4 : 3;
  const address = atyp === 3 ? Buffer.concat([Buffer.from([target.length]), target]) : target;
  socket.write(Buffer.concat([packet([5, 1, 0, atyp]), address, packet([0, 80])]));
  expect((await once(socket, "data"))[0][0]).toBe(5);
  return socket;
}

describe("proxy routing", () => {
  it("matches the complete fixture matrix", async () => {
    expect(routeProxy({ protocol: "http", host: "proxy.test", port: 8080, username: "u", password: "p" })).toEqual({ mode: "direct", launchProxy: { server: "http://proxy.test:8080", username: "u", password: "p" } });
    expect(routeProxy({ protocol: "HTTPS", host: "proxy.test", port: 443 })).toEqual({ mode: "direct", launchProxy: "https://proxy.test:443" });
    expect(routeProxy({ protocol: "socks4", host: "proxy.test", port: 1080 })).toEqual({ mode: "direct", launchProxy: "socks4://proxy.test:1080" });
    expect(routeProxy({ protocol: "socks5", host: "proxy.test", port: 1080, username: "u", password: "p" })).toMatchObject({ mode: "relay", launchProxy: null, upstream: { host: "proxy.test", port: 1080 } });
    expect(routeProxy({ protocol: "http", host: "2001:db8::1", port: 8080 })).toEqual({ mode: "direct", launchProxy: { server: "http://[2001:db8::1]:8080" } });
    expect(() => routeProxy({ protocol: "socks4", host: "proxy.test", port: 1080, username: "u" })).toThrow("SOCKS4 proxy credentials are not supported");
    expect(() => routeProxy({ protocol: "http", host: "proxy.test", port: 65536 })).toThrow("proxy port is invalid");
  });
});

describe("authenticated SOCKS5 relay", () => {
  it("forwards domain, IPv4, and IPv6 requests with remote DNS", async () => {
    const seen: Buffer[] = [];
    const requests: Buffer[] = [];
    const upstreamPort = await upstreamSocks((socket) => {
      socket.on("data", (data) => { seen.push(data); socket.write(data); });
    }, true, requests);
    const relay = new Socks5Relay({ host: "127.0.0.1", port: upstreamPort, username: "user", password: "secret" }, { idleTimeout: 100 });
    relays.push(relay);
    await relay.start();
    for (const target of [Buffer.from("example.test"), packet([127, 0, 0, 1]), Buffer.alloc(16, 1)]) {
      const socket = await connectThroughRelay(Number(new URL(relay.proxyUrl).port), target);
      socket.write(Buffer.from("payload"));
      expect((await once(socket, "data"))[0]).toEqual(Buffer.from("payload"));
      socket.end();
    }
    expect(requests.some((data) => data.includes(Buffer.from("example.test")))).toBe(true);
  });

  it("rejects UDP, malformed clients, bad upstream auth, and keeps serving", async () => {
    const upstreamPort = await upstreamSocks(() => undefined);
    const relay = new Socks5Relay({ host: "127.0.0.1", port: upstreamPort, username: "user", password: "secret" });
    relays.push(relay);
    await relay.start();
    const port = Number(new URL(relay.proxyUrl).port);
    const udp = await connect(port);
    udp.write(packet([5, 1, 0]));
    await once(udp, "data");
    udp.write(packet([5, 3, 0, 1, 0, 0, 0, 0, 0, 0]));
    expect((await once(udp, "data"))[0][1]).toBe(7);
    udp.destroy();
    const malformed = await connect(port);
    malformed.write(packet([4, 0]));
    await once(malformed, "close");
    expect(relay.activeCount).toBe(0);
    const wrong = new Socks5Relay({ host: "127.0.0.1", port: upstreamPort, username: "user", password: "not-secret" });
    relays.push(wrong);
    await wrong.start();
    const rejected = await connect(Number(new URL(wrong.proxyUrl).port));
    rejected.write(packet([5, 1, 0]));
    await once(rejected, "data");
    rejected.write(Buffer.from([5, 1, 0, 3, 4, 101, 99, 104, 111, 0, 80]));
    await once(rejected, "close");
    expect("not-secret").not.toContain("SOCKS relay request failed");
  });

  it("supports concurrent connections and idempotent shutdown", async () => {
    const upstreamPort = await upstreamSocks((socket) => socket.on("data", (data) => socket.write(data)), true, [], "p");
    const relay = new Socks5Relay({ host: "127.0.0.1", port: upstreamPort, username: "u", password: "p" });
    relays.push(relay);
    await relay.start();
    const port = Number(new URL(relay.proxyUrl).port);
    const clients = await Promise.all(Array.from({ length: 20 }, () => connectThroughRelay(port, Buffer.from("echo.test"))));
    await Promise.all(clients.map(async (client) => { client.write(Buffer.from("x")); expect((await once(client, "data"))[0]).toEqual(Buffer.from("x")); client.end(); }));
    await relay.close();
    await relay.close();
    expect(relay.activeCount).toBe(0);
  });
});
