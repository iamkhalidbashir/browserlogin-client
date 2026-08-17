import { createServer, type Server } from "node:http";
import { describe, expect, test } from "vitest";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import {
  INTERCEPTED_INPUT_METHODS,
  MAX_CDP_MESSAGE_BYTES,
  startCdpRelay,
  type RawInput,
} from "../../src/core/cdp/relay.js";

type Upstream = {
  server: Server;
  websocketServer: WebSocketServer;
  connections: number;
  messages: Record<string, unknown>[];
  sockets: Set<WebSocket>;
  url: string;
};

const openSocket = (url: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", () => reject(new Error("websocket did not open")));
  });

const receive = (
  socket: WebSocket,
  timeoutMs = 1_000,
  label = "message",
): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out`)),
      timeoutMs,
    );
    socket.once("message", (raw: RawData) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()) as Record<string, unknown>);
    });
  });

const receiveMatching = (
  socket: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 1_000,
  label = "matching message",
): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`${label} timed out`));
    }, timeoutMs);
    const onMessage = (raw: RawData) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });

const send = (socket: WebSocket, message: Record<string, unknown>): void =>
  socket.send(JSON.stringify(message));

const waitForClose = (socket: WebSocket, timeoutMs = 1_000): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("websocket close timed out")),
      timeoutMs,
    );
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });

const startUpstream = async (
  onMessage: (socket: WebSocket, message: Record<string, unknown>) => void,
): Promise<Upstream> => {
  const server = createServer();
  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_CDP_MESSAGE_BYTES,
  });
  const state: Upstream = {
    server,
    websocketServer,
    connections: 0,
    messages: [],
    sockets: new Set(),
    url: "",
  };
  websocketServer.on("connection", (socket: WebSocket) => {
    state.connections += 1;
    state.sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("message", (raw: RawData) => {
      if (typeof raw !== "string") {
        const message = JSON.parse(raw.toString()) as Record<string, unknown>;
        state.messages.push(message);
        onMessage(socket, message);
      }
    });
    socket.on("close", () => state.sockets.delete(socket));
  });
  server.on("upgrade", (request, socket, head) => {
    websocketServer.handleUpgrade(request, socket, head, (client) => {
      websocketServer.emit("connection", client, request);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("upstream did not bind");
  state.url = `ws://127.0.0.1:${address.port}`;
  return state;
};

const stopUpstream = async (upstream: Upstream): Promise<void> => {
  for (const socket of upstream.sockets) socket.close();
  upstream.websocketServer.close();
  await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
};

describe("CDP input relay", () => {
  test("binds loopback, authenticates one token, and connects upstream after acceptance", async () => {
    const upstream = await startUpstream(() => undefined);
    const relay = await startCdpRelay({
      upstreamUrl: upstream.url,
      worker: { execute: () => undefined },
    });
    expect(relay.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/[^/]+$/);
    await expect(
      openSocket(relay.url.replace(/[^/]+$/, "wrong")),
    ).rejects.toThrow();
    expect(upstream.connections).toBe(0);
    const client = await openSocket(relay.url);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(upstream.connections).toBe(1);
    client.close();
    await expect(openSocket(relay.url)).rejects.toThrow();
    await relay.stop();
    await stopUpstream(upstream);
  });

  test("uses process env without a seam and lets explicit timeoutMs win", async () => {
    const upstream = await startUpstream(() => undefined);
    const previous = process.env.BROWSERLOGIN_CDP_TIMEOUT;
    process.env.BROWSERLOGIN_CDP_TIMEOUT = "20";
    try {
      const relay = await startCdpRelay({
        upstreamUrl: upstream.url,
        worker: { execute: () => undefined },
      });
      const client = await openSocket(relay.url);
      await waitForClose(client);
      await relay.stop();
      const explicit = await startCdpRelay({
        upstreamUrl: upstream.url,
        timeoutMs: 20,
        env: { BROWSERLOGIN_CDP_TIMEOUT: "100" },
        worker: { execute: () => undefined },
      });
      const explicitClient = await openSocket(explicit.url);
      await waitForClose(explicitClient);
      await explicit.stop();
    } finally {
      if (previous === undefined) delete process.env.BROWSERLOGIN_CDP_TIMEOUT;
      else process.env.BROWSERLOGIN_CDP_TIMEOUT = previous;
      await stopUpstream(upstream);
    }
  });

  test("does not process early client traffic until auto-attach succeeds", async () => {
    let releaseAutoAttach!: () => void;
    const upstreamMessages: string[] = [];
    const upstream = await startUpstream((socket, message) => {
      upstreamMessages.push(String(message.method));
      if (message.method === "Target.setAutoAttach")
        void new Promise<void>((resolve) => {
          releaseAutoAttach = () => {
            socket.send(JSON.stringify({ id: message.id, result: {} }));
            resolve();
          };
        });
      else socket.send(JSON.stringify({ id: message.id, result: {} }));
    });
    const relay = await startCdpRelay({
      upstreamUrl: upstream.url,
      worker: { execute: () => undefined },
    });
    const client = await openSocket(relay.url);
    send(client, { id: 90, method: "Runtime.evaluate", params: {} });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(upstreamMessages).toEqual(["Target.setAutoAttach"]);
    releaseAutoAttach();
    expect(await receive(client)).toMatchObject({ id: 90 });
    expect(relay.pendingCount()).toBe(0);
    await relay.stop();
    await stopUpstream(upstream);
  });

  test("closes the client when auto-attach fails and bounds oversized upstream frames", async () => {
    const failing = await startUpstream((socket, message) => {
      if (message.method === "Target.setAutoAttach")
        socket.send(
          JSON.stringify({
            id: message.id,
            error: { code: -1, message: "failed" },
          }),
        );
    });
    const failingRelay = await startCdpRelay({
      upstreamUrl: failing.url,
      worker: { execute: () => undefined },
    });
    const failingClient = await openSocket(failingRelay.url);
    await waitForClose(failingClient);
    expect(failingRelay.pendingCount()).toBe(0);
    await failingRelay.stop();
    await stopUpstream(failing);

    const upstream = await startUpstream(() => undefined);
    const relay = await startCdpRelay({
      upstreamUrl: upstream.url,
      worker: { execute: () => undefined },
    });
    const client = await openSocket(relay.url);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const peer = [...upstream.sockets][0];
    peer?.send("x".repeat(MAX_CDP_MESSAGE_BYTES + 1));
    await waitForClose(client);
    await relay.stop();
    await stopUpstream(upstream);
  });

  test("cleans internal request state and stops with an uncooperative peer", async () => {
    const upstream = await startUpstream(() => undefined);
    const relay = await startCdpRelay({
      upstreamUrl: upstream.url,
      timeoutMs: 20,
      worker: { execute: () => undefined },
    });
    const client = await openSocket(relay.url);
    await waitForClose(client);
    expect(relay.pendingCount()).toBe(0);
    const started = Date.now();
    await relay.stop();
    expect(Date.now() - started).toBeLessThan(500);
    await stopUpstream(upstream);
  });

  test("expires timed-out fallback IDs and keeps pending introspection at zero", async () => {
    const upstream = await startUpstream((socket, message) => {
      if (message.method === "Target.setAutoAttach")
        socket.send(JSON.stringify({ id: message.id, result: {} }));
    });
    const relay = await startCdpRelay({
      upstreamUrl: upstream.url,
      timeoutMs: 20,
      worker: {
        execute: () => new Promise<void>(() => undefined),
      },
    });
    const client = await openSocket(relay.url);
    send(client, {
      id: 91,
      method: "Input.insertText",
      params: { text: "private" },
    });
    expect(await receive(client)).toEqual({
      id: 91,
      error: { code: -32000, message: "CDP relay operation failed" },
    });
    expect(relay.pendingCount()).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(relay.pendingCount()).toBe(0);
    client.close();
    await relay.stop();
    await stopUpstream(upstream);
  });

  test("forwards non-input messages and preserves ids, sessions, and events", async () => {
    const upstream = await startUpstream((socket, message) => {
      if (message.method === "Target.setAutoAttach")
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      else
        socket.send(
          JSON.stringify({
            id: message.id,
            sessionId: message.sessionId,
            result: { echoed: true },
          }),
        );
    });
    const relay = await startCdpRelay({
      upstreamUrl: upstream.url,
      worker: { execute: () => undefined },
    });
    const client = await openSocket(relay.url);
    send(client, {
      id: 7,
      method: "Runtime.evaluate",
      params: { expression: "1+1" },
      sessionId: "s",
    });
    expect(await receive(client)).toEqual({
      id: 7,
      sessionId: "s",
      result: { echoed: true },
    });
    const event = {
      method: "Runtime.consoleAPICalled",
      params: { type: "log" },
      sessionId: "s",
    };
    [...upstream.sockets][0]?.send(JSON.stringify(event));
    expect(await receive(client)).toEqual(event);
    client.close();
    await relay.stop();
    await stopUpstream(upstream);
  });

  test("intercepts exactly four methods, serializes per client, and ACKs after worker completion", async () => {
    expect([...INTERCEPTED_INPUT_METHODS].sort()).toEqual([
      "Input.dispatchKeyEvent",
      "Input.dispatchMouseEvent",
      "Input.dispatchTouchEvent",
      "Input.insertText",
    ]);
    const upstream = await startUpstream((socket, message) => {
      if (message.method === "Target.setAutoAttach")
        socket.send(JSON.stringify({ id: message.id, result: {} }));
    });
    const order: number[] = [];
    let release!: () => void;
    const relay = await startCdpRelay({
      upstreamUrl: upstream.url,
      worker: {
        execute: async (event) => {
          order.push(Number(event.params.sequence));
          if (event.params.sequence === 1)
            await new Promise<void>((resolve) => {
              release = resolve;
            });
        },
      },
    });
    const client = await openSocket(relay.url);
    const firstAck = receiveMatching(client, (message) => message.id === 1);
    const secondAck = receiveMatching(client, (message) => message.id === 2);
    send(client, {
      id: 1,
      method: "Input.dispatchMouseEvent",
      params: { sequence: 1 },
    });
    send(client, {
      id: 2,
      method: "Input.dispatchKeyEvent",
      params: { sequence: 2 },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual([1]);
    release();
    expect(await firstAck).toEqual({ id: 1, result: {} });
    expect(await secondAck).toEqual({ id: 2, result: {} });
    expect(
      upstream.messages.some(
        (message) => message.method === "Input.dispatchMouseEvent",
      ),
    ).toBe(false);
    client.close();
    await relay.stop();
    await stopUpstream(upstream);
  });

  test("keeps mappings for two targets and cancels on navigation with one ACK", async () => {
    let peer: WebSocket | undefined;
    const upstream = await startUpstream((socket, message) => {
      peer = socket;
      if (message.method === "Target.setAutoAttach")
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      if (message.method === "Target.attachToTarget") {
        const targetId = (message.params as Record<string, unknown>).targetId;
        socket.send(
          JSON.stringify({
            id: message.id,
            result: { sessionId: `session-${targetId}` },
          }),
        );
      }
    });
    const seen: RawInput[] = [];
    let aborted = false;
    const relay = await startCdpRelay({
      upstreamUrl: upstream.url,
      worker: {
        execute: (event, signal) => {
          seen.push(event);
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
            },
            { once: true },
          );
          return new Promise<void>(() => undefined);
        },
      },
    });
    const client = await openSocket(relay.url);
    send(client, {
      id: 1,
      method: "Target.attachToTarget",
      params: { targetId: "popup-a", flatten: true },
    });
    expect(await receive(client, 1_000, "attach-a")).toMatchObject({
      id: 1,
      result: { sessionId: "session-popup-a" },
    });
    send(client, {
      id: 2,
      method: "Target.attachToTarget",
      params: { targetId: "popup-b", flatten: true },
    });
    expect(await receive(client, 1_000, "attach-b")).toMatchObject({
      id: 2,
      result: { sessionId: "session-popup-b" },
    });
    const ack = receiveMatching(
      client,
      (message) => message.id === 3,
      1_000,
      "navigation ack",
    );
    send(client, {
      id: 3,
      method: "Input.insertText",
      params: { text: "private" },
      sessionId: "session-popup-a",
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen[0]?.sessionId).toBe("session-popup-a");
    expect(seen[0]?.targetId).toBe("popup-a");
    peer?.send(
      JSON.stringify({
        method: "Page.frameNavigated",
        params: { frame: { id: "f" } },
        sessionId: "session-popup-a",
      }),
    );
    expect(await ack).toEqual({
      id: 3,
      sessionId: "session-popup-a",
      result: {},
    });
    expect(aborted).toBe(true);
    expect(relay.pendingCount()).toBe(0);
    send(client, {
      id: 4,
      method: "Input.dispatchTouchEvent",
      params: { touchPoints: [] },
      sessionId: "session-popup-b",
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const destroyAck = receiveMatching(
      client,
      (message) => message.id === 4,
      1_000,
      "detach ack",
    );
    peer?.send(
      JSON.stringify({
        method: "Target.targetDestroyed",
        params: { targetId: "popup-b" },
      }),
    );
    expect(await destroyAck).toEqual({
      id: 4,
      sessionId: "session-popup-b",
      result: {},
    });
    expect(relay.pendingCount()).toBe(0);
    client.close();
    await relay.stop();
    await stopUpstream(upstream);
  });

  test("uses bounded keyboard fallback after worker timeout and waits for upstream", async () => {
    const upstream = await startUpstream((socket, message) => {
      if (message.method === "Target.setAutoAttach")
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      if (
        typeof message.id === "string" &&
        message.id.startsWith("__browserlogin_")
      )
        setTimeout(
          () => socket.send(JSON.stringify({ id: message.id, result: {} })),
          25,
        );
    });
    let aborted = false;
    const relay = await startCdpRelay({
      upstreamUrl: upstream.url,
      timeoutMs: 100,
      worker: {
        execute: (_event, signal) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
            },
            { once: true },
          );
          return new Promise<void>(() => undefined);
        },
      },
    });
    const client = await openSocket(relay.url);
    const start = Date.now();
    send(client, {
      id: 8,
      method: "Input.insertText",
      params: { text: "private" },
    });
    expect(await receive(client)).toEqual({ id: 8, result: {} });
    expect(Date.now() - start).toBeGreaterThanOrEqual(80);
    expect(aborted).toBe(true);
    expect(
      upstream.messages.find((message) => message.method === "Input.insertText")
        ?.method,
    ).toBe("Input.insertText");
    client.close();
    await relay.stop();
    await stopUpstream(upstream);
  });

  test("keeps mouse and touch fallback disabled by default and maps fallback errors generically", async () => {
    const upstream = await startUpstream((socket, message) => {
      if (message.method === "Target.setAutoAttach")
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      if (
        typeof message.id === "string" &&
        message.id.startsWith("__browserlogin_")
      )
        socket.send(
          JSON.stringify({
            id: message.id,
            error: { code: -1, message: "private upstream detail" },
          }),
        );
    });
    const relay = await startCdpRelay({
      upstreamUrl: upstream.url,
      worker: {
        execute: () => {
          throw new Error("worker failed");
        },
      },
    });
    const client = await openSocket(relay.url);
    send(client, {
      id: 9,
      method: "Input.dispatchMouseEvent",
      params: { type: "mouseMoved" },
    });
    expect(await receive(client)).toEqual({
      id: 9,
      error: { code: -32000, message: "CDP relay operation failed" },
    });
    send(client, {
      id: 10,
      method: "Input.dispatchTouchEvent",
      params: { touchPoints: [] },
    });
    expect(await receive(client)).toEqual({
      id: 10,
      error: { code: -32000, message: "CDP relay operation failed" },
    });
    expect(
      upstream.messages.some(
        (message) =>
          message.method === "Input.dispatchMouseEvent" ||
          message.method === "Input.dispatchTouchEvent",
      ),
    ).toBe(false);
    client.close();
    await relay.stop();
    await stopUpstream(upstream);
  });

  test("cancels active work on client close and rejects malformed text", async () => {
    const upstream = await startUpstream((socket, message) => {
      if (message.method === "Target.setAutoAttach")
        socket.send(JSON.stringify({ id: message.id, result: {} }));
    });
    let aborted = false;
    const relay = await startCdpRelay({
      upstreamUrl: upstream.url,
      worker: {
        execute: (_event, signal) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
            },
            { once: true },
          );
          return new Promise<void>(() => undefined);
        },
      },
    });
    const client = await openSocket(relay.url);
    send(client, {
      id: 11,
      method: "Input.dispatchKeyEvent",
      params: { type: "keyDown" },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    client.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(aborted).toBe(true);
    expect(relay.pendingCount()).toBe(0);
    await relay.stop();
    const malformedRelay = await startCdpRelay({
      upstreamUrl: upstream.url,
      worker: { execute: () => undefined },
    });
    const malformedClient = await openSocket(malformedRelay.url);
    const malformedClosed = new Promise<void>((resolve) =>
      malformedClient.once("close", () => resolve()),
    );
    malformedClient.send("not json");
    await malformedClosed;
    await malformedRelay.stop();
    await stopUpstream(upstream);
  });

  test("fails closed for oversized and binary messages, and rejects unsafe configuration", async () => {
    const upstream = await startUpstream(() => undefined);
    await expect(
      startCdpRelay({
        upstreamUrl: "http://127.0.0.1",
        worker: { execute: () => undefined },
      }),
    ).rejects.toThrow("ws or wss");
    await expect(
      startCdpRelay({
        upstreamUrl: upstream.url,
        env: { BROWSERLOGIN_CDP_TIMEOUT: "nope" },
        worker: { execute: () => undefined },
      }),
    ).rejects.toThrow("invalid");
    const relay = await startCdpRelay({
      upstreamUrl: upstream.url,
      worker: { execute: () => undefined },
    });
    const client = await openSocket(relay.url);
    client.send(new Uint8Array(MAX_CDP_MESSAGE_BYTES + 1));
    await new Promise<void>((resolve) => client.once("close", () => resolve()));
    await relay.stop();
    await stopUpstream(upstream);
  });
});
