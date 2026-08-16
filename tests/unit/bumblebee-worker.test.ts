import { describe, expect, it } from "vitest";
import { BumblebeeWorker } from "../../src/core/bumblebee/worker";
import type { Point } from "../../src/core/bumblebee/types";

describe("Bumblebee worker input semantics", () => {
  it("dispatches ordered mouse, click, key, text, and touch events", async () => {
    const seen: {
      method: string;
      params: Record<string, unknown>;
      session?: string;
    }[] = [];
    const worker = await BumblebeeWorker.create({
      sessionId: "worker-session",
      policy: {
        rollout: async (start: Point, target: Point) => [start, target],
      } as never,
      sender: {
        send: async (method, params, session) => {
          seen.push({ method, params, session });
        },
      },
    });
    const signal = new AbortController().signal;
    await worker.execute(
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseMoved", x: 10, y: 20 },
        sessionId: "page-a",
      },
      signal,
    );
    await worker.execute(
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mousePressed",
          x: 10,
          y: 20,
          button: "left",
          buttons: 1,
          modifiers: 8,
          clickCount: 2,
        },
        sessionId: "page-a",
      },
      signal,
    );
    await worker.execute(
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mouseReleased",
          x: 10,
          y: 20,
          button: "left",
          buttons: 0,
          modifiers: 8,
          clickCount: 2,
        },
        sessionId: "page-a",
      },
      signal,
    );
    await worker.execute(
      {
        method: "Input.dispatchKeyEvent",
        params: {
          type: "keyDown",
          key: "A",
          code: "KeyA",
          modifiers: 8,
          text: "A",
        },
        sessionId: "page-a",
      },
      signal,
    );
    await worker.execute(
      {
        method: "Input.insertText",
        params: { text: "private text" },
        sessionId: "page-a",
      },
      signal,
    );
    await worker.execute(
      {
        method: "Input.dispatchTouchEvent",
        params: { type: "touchStart", touchPoints: [{ x: 1, y: 2 }] },
        sessionId: "page-a",
      },
      signal,
    );
    const mouseTypes = seen
      .filter((entry) => entry.method === "Input.dispatchMouseEvent")
      .map((entry) => entry.params.type);
    expect(
      mouseTypes.filter((type) => type === "mouseMoved").length,
    ).toBeGreaterThanOrEqual(3);
    expect(mouseTypes.indexOf("mousePressed")).toBeGreaterThan(-1);
    expect(mouseTypes.indexOf("mouseReleased")).toBeGreaterThan(
      mouseTypes.indexOf("mousePressed"),
    );
    expect(
      seen.find((entry) => entry.params.type === "mousePressed")?.params,
    ).toMatchObject({
      type: "mousePressed",
      button: "left",
      modifiers: 8,
      clickCount: 2,
    });
    expect(
      seen.find((entry) => entry.params.type === "keyDown")?.params,
    ).toMatchObject({ type: "keyDown", key: "A", text: "A", modifiers: 8 });
    expect(
      seen
        .filter((entry) => entry.method === "Input.insertText")
        .map((entry) => entry.params.text)
        .join(""),
    ).toBe("private text");
    expect(seen.at(-1)?.session).toBe("page-a");
  });

  it("hash-fails a corrupt model and still uses bounded classical input", async () => {
    const seen: string[] = [];
    const model = new Uint8Array([1, 2, 3]);
    const worker = await BumblebeeWorker.create({
      policyOptions: { modelBytes: model, wasmBytes: new Uint8Array([1]) },
      sender: {
        send: async (method) => {
          seen.push(method);
        },
      },
    });
    await worker.execute(
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseMoved", x: 200, y: 200 },
      },
      new AbortController().signal,
    );
    expect(worker.metrics.classicalFallbacks).toBeGreaterThan(0);
    expect(seen).toContain("Input.dispatchMouseEvent");
  });
});
