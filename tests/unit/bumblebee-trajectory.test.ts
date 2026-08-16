import { describe, expect, it } from "vitest";
import { HumanMouse } from "../../src/core/bumblebee/mouse";
import { classicalPath } from "../../src/core/bumblebee/profiles";
import { MOUSE_PROFILES } from "../../src/core/bumblebee/profiles";
import { SCREEN } from "../../src/core/bumblebee/policy";

const sender = { send: async () => {} };
const points = (seed: number) =>
  classicalPath({ x: 10, y: 20 }, { x: 3900, y: 2200 }, "natural", seed);

describe("Bumblebee bounded trajectories", () => {
  it("keeps the five Python profile parameter tables exact", () => {
    expect(MOUSE_PROFILES.default).toMatchObject({
      speed_px_s: 2000,
      target_segment_length_px: 12,
      min_path_points: 18,
      max_path_points: 120,
      curve_strength: 0,
      jitter_px: 0,
    });
    expect(MOUSE_PROFILES.precise).toMatchObject({
      speed_px_s: 1200,
      speed_variation: 0.02,
    });
    expect(MOUSE_PROFILES.fast).toMatchObject({
      speed_px_s: 3200,
      min_path_points: 12,
      max_path_points: 80,
    });
    expect(MOUSE_PROFILES.natural).toMatchObject({
      speed_px_s: 2000,
      curve_strength: 0.06,
      jitter_px: 1,
    });
    expect(MOUSE_PROFILES.messy).toMatchObject({
      speed_px_s: 1800,
      speed_variation: 0.12,
      speed_factor_variation: 0.08,
      curve_strength: 0.12,
      jitter_px: 3,
    });
  });

  it("reproduces 60 seeded paths, stays bounded, and ends exactly at target", () => {
    for (let seed = 0; seed < 60; seed++) {
      const path = points(seed);
      expect(path).toEqual(points(seed));
      expect(path.length).toBeLessThanOrEqual(120);
      expect(
        path.every(
          (point) =>
            point.x >= 0 &&
            point.x < SCREEN.width &&
            point.y >= 0 &&
            point.y < SCREEN.height,
        ),
      ).toBe(true);
      expect(path.at(-1)).toEqual({ x: 3900, y: 2200 });
    }
  });

  it.each([
    [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ],
    [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
    ],
    [
      { x: 0, y: 0 },
      { x: 4095, y: 2303 },
    ],
    [
      { x: 2048, y: 1152 },
      { x: 4095, y: 2303 },
    ],
  ])("handles bounded edge case %j -> %j", (start, target) => {
    const path = classicalPath(start, target, "default", 42);
    expect(path.at(-1)).toEqual(target);
    expect(path.length).toBeLessThanOrEqual(120);
  });

  it("uses a bounded classical fallback for NaN policy output", async () => {
    const metrics = {
      classicalFallbacks: 0,
      reasons: {} as Record<string, number>,
    };
    const mouse = new HumanMouse(sender, undefined, {
      metrics,
      policy: { rollout: async () => [{ x: Number.NaN, y: 1 }] } as never,
    });
    await mouse.move({ x: 100, y: 100 });
    expect(metrics.classicalFallbacks).toBe(1);
    expect(mouse.current).toEqual({ x: 100, y: 100 });
  });
});
