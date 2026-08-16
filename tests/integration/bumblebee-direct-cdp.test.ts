import { createServer } from "node:http";
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
      },
      new AbortController().signal,
    );
    await worker.close();
    await new Promise<void>((resolve) =>
      server.close(() => httpServer.close(() => resolve())),
    );
  }, 10_000);
});
