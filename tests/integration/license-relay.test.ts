import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureStatePaths,
  posixPathSecurity,
  statePaths,
} from "../../src/core/config/paths.js";
import {
  DEFAULT_RELAY_PORT,
  LICENSE_ROUTES,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  discoverExistingRelay,
  relayUrl,
  startLicenseRelay,
  type RelayResponse,
  type UpstreamRequest,
} from "../../src/core/license/relay.js";

const temp = () => mkdtemp(join(tmpdir(), "browserlogin-task15-"));
const raw = (port: number, bytes: string | Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    socket.on("connect", () => socket.end(bytes));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("close", () => resolve(Buffer.concat(chunks)));
    socket.on("error", reject);
  });

const request = (
  port: number,
  route: string,
  body: Buffer,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Buffer }> =>
  new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: route,
        method: "POST",
        headers: { "content-length": body.length, ...headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });

describe("Task 15 license relay", () => {
  it("forwards only the three POST routes without mutating the body", async () => {
    const root = await temp();
    const seen: UpstreamRequest[] = [];
    const transport = async (
      value: UpstreamRequest,
    ): Promise<RelayResponse> => {
      seen.push({ ...value, body: Buffer.from(value.body) });
      return {
        status: 201,
        headers: { "content-type": "application/json", "x-upstream": "yes" },
        body: value.body,
      };
    };
    const relay = await startLicenseRelay({ root, port: 0, transport });
    const body = Buffer.from('{"license_key":"test","route":"opaque"}');
    for (const route of LICENSE_ROUTES) {
      const result = await request(relay.control.port, route, body, {
        accept: "application/json",
        "accept-encoding": "gzip, deflate",
      });
      expect(result.status).toBe(201);
      expect(result.body).toEqual(body);
    }
    expect(seen).toHaveLength(3);
    expect(seen.map((entry) => entry.route)).toEqual([...LICENSE_ROUTES]);
    expect(
      seen.every((entry) => entry.headers.host === "cloakbrowser.dev"),
    ).toBe(true);
    expect(seen.every((entry) => entry.body.equals(body))).toBe(true);
    await relay.close();
  });

  it("rejects malformed methods, routes, headers, lengths, and oversized requests", async () => {
    const root = await temp();
    let forwarded = 0;
    const relay = await startLicenseRelay({
      root,
      port: 0,
      transport: async () => {
        forwarded += 1;
        return { status: 200, headers: {}, body: Buffer.from("ok") };
      },
    });
    const cases = [
      "GET /api/license/session/start HTTP/1.1\r\nHost: x\r\n\r\n",
      "POST /api/license/session/unknown HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n",
      "POST /api/license/session/start?x=1 HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n",
      "POST /api/license/session/start#x HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n",
      "POST /api/license/session/start HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nTransfer-Encoding: chunked\r\n\r\n",
      "POST /api/license/session/start HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nExpect: 100-continue\r\n\r\n",
      "POST /api/license/session/start HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nX-Not-Allowed: x\r\n\r\n",
      "POST /api/license/session/start HTTP/1.1\r\nHost: x\r\nContent-Length: nope\r\n\r\n",
      "POST /api/license/session/start HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\n\r\n",
      "POST /api/license/session/start HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\na",
      `POST /api/license/session/start HTTP/1.1\r\nHost: x\r\nContent-Length: ${MAX_REQUEST_BYTES}\r\n\r\n${"x".repeat(MAX_REQUEST_BYTES)}`,
    ];
    for (const value of cases) {
      const response = await raw(relay.control.port, value);
      expect(response.toString()).toMatch(/HTTP\/1\.1 (400|404|405|413)/);
    }
    expect(forwarded).toBe(0);
    await relay.close();
  });

  it("authenticates ownership and rejects a foreign nonce", async () => {
    const root = await temp();
    const relay = await startLicenseRelay({
      root,
      port: 0,
      nonce: "a".repeat(64),
      transport: async () => ({
        status: 200,
        headers: {},
        body: Buffer.alloc(0),
      }),
    });
    expect(await discoverExistingRelay(root, "b".repeat(64))).toBeNull();
    expect(await discoverExistingRelay(root, "a".repeat(64))).toEqual(
      relay.control,
    );
    const control = JSON.parse(
      await readFile(join(root, "state", "license-relay.json"), "utf8"),
    );
    expect(Object.keys(control).sort()).toEqual([
      "nonce",
      "pid",
      "port",
      "start_time",
    ]);
    if (process.platform !== "win32")
      expect(
        (await stat(join(root, "state", "license-relay.json"))).mode & 0o777,
      ).toBe(0o600);
    expect(
      (
        await fetch(
          `http://127.0.0.1:${relay.control.port}/__browserlogin/license-relay/peer`,
          {
            headers: { "x-browserlogin-relay-nonce": "b".repeat(64) },
          },
        )
      ).status,
    ).toBe(401);
    await expect(
      stat(join(root, "state", "license-relay.json")),
    ).resolves.toBeDefined();
    await relay.close();
    await expect(
      stat(join(root, "state", "license-relay.json")),
    ).rejects.toThrow();
  });

  it("does not deliver an upstream zstd response to a client that did not advertise it", async () => {
    const root = await temp();
    let requests = 0;
    const relay = await startLicenseRelay({
      root,
      port: 0,
      transport: async () => {
        requests += 1;
        return {
          status: 200,
          headers: { "content-encoding": "zstd" },
          body: Buffer.from("compressed"),
        };
      },
    });
    expect(
      (
        await request(relay.control.port, LICENSE_ROUTES[0], Buffer.alloc(0), {
          "accept-encoding": "gzip, deflate",
        })
      ).status,
    ).toBe(502);
    expect(
      (
        await request(relay.control.port, LICENSE_ROUTES[0], Buffer.alloc(0), {
          "accept-encoding": "zstd",
        })
      ).status,
    ).toBe(200);
    expect(requests).toBe(2);
    await relay.close();
  });

  it("caps upstream responses and prefers the default loopback URL", async () => {
    expect(
      Buffer.byteLength(relayUrl(DEFAULT_RELAY_PORT), "ascii"),
    ).toBeLessThanOrEqual(24);
    const root = await temp();
    const relay = await startLicenseRelay({
      root,
      port: 0,
      transport: async () => ({
        status: 200,
        headers: {},
        body: Buffer.alloc(MAX_RESPONSE_BYTES + 1),
      }),
    });
    expect(
      (await request(relay.control.port, LICENSE_ROUTES[0], Buffer.alloc(0)))
        .status,
    ).toBe(502);
    await relay.close();
  });

  it("honors explicit port over injected environment and rejects invalid environment ports", async () => {
    const explicitRoot = await temp();
    const explicit = await startLicenseRelay({
      root: explicitRoot,
      port: 4398,
      env: { BROWSERLOGIN_LICENSE_PORT: "4399" },
      transport: async () => ({
        status: 200,
        headers: {},
        body: Buffer.alloc(0),
      }),
    });
    expect(explicit.control.port).toBe(4398);
    await explicit.close();

    const invalidRoot = await temp();
    await expect(
      startLicenseRelay({
        root: invalidRoot,
        env: { BROWSERLOGIN_LICENSE_PORT: "not-a-port" },
      }),
    ).rejects.toThrow("relay environment port is invalid");
    await expect(
      stat(join(invalidRoot, "state", "license-relay.json")),
    ).rejects.toThrow();
  });

  it("maps an upstream timeout to 504 and a client body timeout to 408", async () => {
    const root = await temp();
    const relay = await startLicenseRelay({
      root,
      transport: async () => new Promise<RelayResponse>(() => undefined),
    });
    const clientTimeout = await new Promise<number>((resolve, reject) => {
      const socket = connect(relay.control.port, "127.0.0.1");
      const chunks: Buffer[] = [];
      socket.on("connect", () =>
        socket.write(
          "POST /api/license/session/start HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\n\r\n{",
        ),
      );
      socket.on("data", (chunk: Buffer) => chunks.push(chunk));
      socket.on("close", () => {
        const match = Buffer.concat(chunks)
          .toString("ascii")
          .match(/HTTP\/1\.1 (\d+)/);
        if (match) resolve(Number(match[1]));
        else reject(new Error("missing client timeout response"));
      });
      socket.on("error", reject);
    });
    expect(clientTimeout).toBe(408);
    const upstream = await Promise.race([
      request(relay.control.port, LICENSE_ROUTES[0], Buffer.alloc(0)),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("test timeout waiting for relay")),
          16_000,
        ),
      ),
    ]);
    expect(upstream.status).toBe(504);
    await relay.close();
  }, 25_000);

  it("removes a safe legacy control file before starting", async () => {
    const root = await temp();
    const legacy = join(root, "state", "license-relay.control.json");
    await ensureStatePaths(statePaths(root));
    await writeFile(legacy, "{}", "utf8");
    await chmod(legacy, 0o600);
    const relay = await startLicenseRelay({
      root,
      port: 4397,
      transport: async () => ({
        status: 200,
        headers: {},
        body: Buffer.alloc(0),
      }),
    });
    await expect(stat(legacy)).rejects.toThrow();
    await expect(
      stat(join(root, "state", "license-relay.json")),
    ).resolves.toBeDefined();
    await relay.close();
  });

  it("closes the bound server and removes control state when startup persistence fails", async () => {
    const root = await temp();
    const baseSecurity = posixPathSecurity();
    const security = {
      ...baseSecurity,
      verify: async (path: string, directory: boolean) => {
        if (!directory && path.endsWith("license-relay.json"))
          throw new Error("injected control persistence failure");
        await baseSecurity.verify(path, directory);
      },
    };
    await expect(
      startLicenseRelay({
        root,
        port: 4396,
        security,
        transport: async () => ({
          status: 200,
          headers: {},
          body: Buffer.alloc(0),
        }),
      }),
    ).rejects.toThrow("injected control persistence failure");
    await expect(
      stat(join(root, "state", "license-relay.json")),
    ).rejects.toThrow();
    const retry = await startLicenseRelay({
      root,
      port: 4396,
      transport: async () => ({
        status: 200,
        headers: {},
        body: Buffer.alloc(0),
      }),
    });
    await retry.close();
  });

  it("scans 4291 through 4399 when the default port is occupied", async () => {
    let blocker: ReturnType<typeof createServer> | undefined;
    let blockerPort = DEFAULT_RELAY_PORT;
    for (const candidate of Array.from(
      { length: 109 },
      (_, index) => 4290 + index,
    )) {
      const candidateServer = createServer();
      const available = await new Promise<boolean>((resolve) => {
        candidateServer.once("error", () => {
          candidateServer.close(() => resolve(false));
        });
        candidateServer.listen(candidate, "127.0.0.1", () => resolve(true));
      });
      if (available) {
        blocker = candidateServer;
        blockerPort = candidate;
        break;
      }
    }
    if (!blocker)
      throw new Error("no test port was available in the relay scan range");
    const root = await temp();
    const relay = await startLicenseRelay({
      root,
      transport: async () => ({
        status: 200,
        headers: {},
        body: Buffer.alloc(0),
      }),
    });
    expect(relay.control.port).toBeGreaterThan(blockerPort);
    expect(relay.control.port).toBeLessThanOrEqual(4399);
    expect(relay.server.address()).toMatchObject({
      address: "127.0.0.1",
      family: "IPv4",
    });
    await relay.close();
    await new Promise<void>((resolve) => blocker?.close(() => resolve()));
  });
});
