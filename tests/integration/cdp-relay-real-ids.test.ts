import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import { startCdpRelay, type CdpRelay } from "../../src/core/cdp/relay.js";

const relays: CdpRelay[] = [];
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(relays.splice(0).map((relay) => relay.stop()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

describe("CDP relay Chromium compatibility", () => {
  it("uses integer IDs for internal auto-attach requests", async () => {
    const server = createServer();
    servers.push(server);
    const websocketServer = new WebSocketServer({
      noServer: true,
      maxPayload: 1024 * 1024,
    });
    let autoAttachId: unknown;
    server.on("upgrade", (request, socket, head) => {
      websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        websocketServer.emit("connection", websocket, request);
      });
    });
    websocketServer.on("connection", (socket) => {
      socket.on("message", (raw: RawData) => {
        const message = JSON.parse(raw.toString()) as {
          readonly id?: unknown;
          readonly method?: unknown;
        };
        if (message.method === "Target.setAutoAttach") {
          autoAttachId = message.id;
          if (typeof message.id !== "number") {
            socket.send(
              JSON.stringify({
                error: {
                  code: -32600,
                  message: "Message must have integer 'id' property",
                },
              }),
            );
            return;
          }
        }
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("test CDP server did not bind");
    const relay = await startCdpRelay({
      upstreamUrl: `ws://127.0.0.1:${address.port}`,
      worker: { execute: () => undefined },
    });
    relays.push(relay);
    const client = new WebSocket(relay.url);
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    client.send(JSON.stringify({ id: 1, method: "Browser.getVersion" }));
    const response = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("CDP response timed out")),
          1_000,
        );
        client.once("message", (raw) => {
          clearTimeout(timer);
          resolve(JSON.parse(raw.toString()) as Record<string, unknown>);
        });
        client.once("close", () => {
          clearTimeout(timer);
          reject(new Error("CDP relay closed before response"));
        });
      },
    );

    expect(autoAttachId).toBeTypeOf("number");
    expect(autoAttachId).toBeLessThan(0);
    expect(response).toMatchObject({ id: 1, result: {} });
    client.close();
  });
});
