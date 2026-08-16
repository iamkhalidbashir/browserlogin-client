import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { WebSocketServer, type RawData } from "ws";
import { describe, expect, it } from "vitest";
import { DirectCdpSender } from "../../src/core/bumblebee/direct-cdp";
import { BumblebeeWorker } from "../../src/core/bumblebee/worker";

describe("Bumblebee direct CDP ownership", () => {
  it("attaches lazily, retries one stale session, and closes cleanly", async () => {
    const httpServer = createServer();
    const server = new WebSocketServer({
      server: httpServer,
      maxPayload: 16 * 1024 * 1024,
    } as never);
    const messages: Record<string, unknown>[] = [];
    let attachCount = 0;
    let stale = true;
    server.on("connection", (socket) => {
      socket.on("message", (raw: RawData) => {
        const message = JSON.parse(raw.toString()) as Record<string, unknown>;
        messages.push(message);
        const method = message.method;
        if (method === "Target.getTargets")
          socket.send(
            JSON.stringify({
              id: message.id,
              result: {
                targetInfos: [
                  {
                    type: "page",
                    targetId: "target-1",
                    url: "https://local.test",
                  },
                ],
              },
            }),
          );
        else if (method === "Target.attachToTarget") {
          attachCount += 1;
          socket.send(
            JSON.stringify({
              id: message.id,
              result: { sessionId: `session-${attachCount}` },
            }),
          );
        } else if (method === "Runtime.evaluate" && stale) {
          stale = false;
          socket.send(
            JSON.stringify({
              id: message.id,
              error: { code: -32000, message: "Session not found" },
            }),
          );
        } else
          socket.send(JSON.stringify({ id: message.id, result: { ok: true } }));
      });
    });
    await new Promise<void>((resolve) =>
      httpServer.listen(0, "127.0.0.1", () => resolve()),
    );
    const address = httpServer.address();
    if (!address || typeof address === "string")
      throw new Error("mock server did not bind");
    const sender = new DirectCdpSender(`ws://127.0.0.1:${address.port}`);
    await sender.request("Runtime.evaluate", { expression: "1" });
    expect(attachCount).toBe(2);
    expect(messages.map((message) => message.method)).toEqual([
      "Target.getTargets",
      "Target.attachToTarget",
      "Runtime.evaluate",
      "Target.attachToTarget",
      "Runtime.evaluate",
    ]);
    await sender.close();
    const worker = await BumblebeeWorker.create({
      browserWsUrl: `ws://127.0.0.1:${address.port}`,
      policy: { rollout: async () => [{ x: 0, y: 0 }] } as never,
    });
    await worker.execute(
      {
        method: "Input.dispatchTouchEvent",
        params: { type: "touchStart", touchPoints: [] },
        sessionId: "foreign-relay-session",
        targetId: "target-2",
      },
      new AbortController().signal,
    );
    expect(attachCount).toBe(3);
    const workerAttach = messages
      .filter((message) => message.method === "Target.attachToTarget")
      .at(-1);
    expect(workerAttach?.params).toMatchObject({
      targetId: "target-2",
      flatten: true,
    });
    const workerTouch = messages
      .filter((message) => message.method === "Input.dispatchTouchEvent")
      .at(-1);
    expect(workerTouch?.sessionId).toBe("session-3");
    expect(workerTouch?.sessionId).not.toBe("foreign-relay-session");
    await worker.close();
    await new Promise<void>((resolve) =>
      server.close(() => httpServer.close(() => resolve())),
    );
  }, 10_000);

  it("parses fragmented frames and rejects malformed or oversized frames", async () => {
    class FakeSocket extends EventEmitter {
      readyState = 1;
      terminated = false;
      malformed = false;
      oversized = false;
      send(payload: string): void {
        const request = JSON.parse(payload) as { id: number; method: string };
        queueMicrotask(() => {
          if (this.malformed) {
            this.emit("message", Buffer.from("{"));
            return;
          }
          if (this.oversized) {
            this.emit("message", Buffer.alloc(1025));
            return;
          }
          const response =
            request.method === "Target.getTargets"
              ? {
                  id: request.id,
                  result: {
                    targetInfos: [
                      {
                        type: "page",
                        targetId: "fake-target",
                        url: "https://local.test",
                      },
                    ],
                  },
                }
              : request.method === "Target.attachToTarget"
                ? { id: request.id, result: { sessionId: "fake-session" } }
                : { id: request.id, result: { ok: true } };
          const encoded = Buffer.from(JSON.stringify(response));
          this.emit("message", [encoded.subarray(0, 2), encoded.subarray(2)]);
        });
      }
      close(): void {
        this.emit("close");
      }
      terminate(): void {
        this.terminated = true;
        this.emit("close");
      }
    }
    const fragmented = new FakeSocket();
    const fragmentedSender = new DirectCdpSender("ws://fake", {
      socketFactory: () => {
        queueMicrotask(() => fragmented.emit("open"));
        return fragmented as never;
      },
    });
    await expect(
      fragmentedSender.request("Runtime.evaluate", {}),
    ).resolves.toMatchObject({ ok: true });
    await fragmentedSender.close();

    const malformed = new FakeSocket();
    malformed.malformed = true;
    const malformedSender = new DirectCdpSender("ws://fake", {
      socketFactory: () => {
        queueMicrotask(() => malformed.emit("open"));
        return malformed as never;
      },
    });
    await expect(
      malformedSender.request("Runtime.evaluate", {}),
    ).rejects.toThrow("direct CDP request failed");
    expect(malformed.terminated).toBe(true);

    const oversized = new FakeSocket();
    oversized.oversized = true;
    const oversizedSender = new DirectCdpSender("ws://fake", {
      maxMessageBytes: 1024,
      socketFactory: () => {
        queueMicrotask(() => oversized.emit("open"));
        return oversized as never;
      },
    });
    await expect(
      oversizedSender.request("Runtime.evaluate", {}),
    ).rejects.toThrow("direct CDP request failed");
    expect(oversized.terminated).toBe(true);
  });
});
