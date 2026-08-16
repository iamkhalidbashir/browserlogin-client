import { describe, expect, test } from "vitest";
import { BumblebeeWorker } from "../../src/core/bumblebee/worker.js";
import type { OnnxMousePolicy } from "../../src/core/bumblebee/policy.js";

describe("Task 19/20 humanized click seam", () => {
  test("dispatches multiple ordered mouse moves before press/release", async () => {
    const events: Array<{ method: string; params: Record<string, unknown> }> =
      [];
    const sender = {
      send: async (method: string, params: Record<string, unknown>) => {
        events.push({ method, params });
      },
    };
    const policy = {
      rollout: async () => [
        { x: 0, y: 0 },
        { x: 1200, y: 700 },
        { x: 2400, y: 1400 },
        { x: 3000, y: 1800 },
      ],
    } as unknown as OnnxMousePolicy;
    const worker = await BumblebeeWorker.create({ sender, policy });
    await worker.execute(
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mousePressed", x: 300, y: 200 },
      },
      new AbortController().signal,
    );
    await worker.execute(
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseMoved", x: 320, y: 220 },
      },
      new AbortController().signal,
    );
    await worker.execute(
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseReleased", x: 320, y: 220 },
      },
      new AbortController().signal,
    );
    const mouseEvents = events.filter(
      (event) => event.method === "Input.dispatchMouseEvent",
    );
    const pressIndex = mouseEvents.findIndex(
      (event) => event.params.type === "mousePressed",
    );
    const releaseIndex = mouseEvents.findIndex(
      (event) => event.params.type === "mouseReleased",
    );
    expect(
      mouseEvents
        .slice(0, pressIndex)
        .filter((event) => event.params.type === "mouseMoved").length,
    ).toBeGreaterThan(1);
    expect(pressIndex).toBeLessThan(releaseIndex);
    expect(mouseEvents.map((event) => event.params.type)).toContain(
      "mouseMoved",
    );
    await worker.close();
  });
});
