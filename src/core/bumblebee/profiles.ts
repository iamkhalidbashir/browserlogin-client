import type { Point, ProfileName } from "./types";

export type MouseProfile = {
  speed_px_s: number;
  target_segment_length_px: number;
  min_path_points: number;
  max_path_points: number;
  min_segment_distance_px: number;
  max_segment_distance_px: number;
  short_move_duration_threshold: number;
  fast_segment_distance_px: number;
  fast_segment_speed_multiplier: number;
  speed_variation: number;
  speed_factor_variation: number;
  min_speed_factor: number;
  max_speed_factor: number;
  curve_strength: number;
  max_curve_px: number;
  jitter_px: number;
  target_radius_px: number;
  force_destination: boolean;
  trim_after_target_reached: boolean;
  click_pause_range: readonly [number, number];
  post_move_click_pause_range: readonly [number, number];
};

const base: MouseProfile = {
  speed_px_s: 2000,
  target_segment_length_px: 12,
  min_path_points: 18,
  max_path_points: 120,
  min_segment_distance_px: 5,
  max_segment_distance_px: 8,
  short_move_duration_threshold: 0.1,
  fast_segment_distance_px: 40,
  fast_segment_speed_multiplier: 1.2,
  speed_variation: 0.05,
  speed_factor_variation: 0.03,
  min_speed_factor: 0.65,
  max_speed_factor: 1.25,
  curve_strength: 0,
  max_curve_px: 120,
  jitter_px: 0,
  target_radius_px: 8,
  force_destination: true,
  trim_after_target_reached: true,
  click_pause_range: [0.05, 0.1],
  post_move_click_pause_range: [0.1, 1.4],
};

export const MOUSE_PROFILES: Record<ProfileName, MouseProfile> = {
  default: base,
  precise: { ...base, speed_px_s: 1200, speed_variation: 0.02 },
  fast: { ...base, speed_px_s: 3200, min_path_points: 12, max_path_points: 80 },
  natural: { ...base, curve_strength: 0.06, jitter_px: 1 },
  messy: {
    ...base,
    speed_px_s: 1800,
    speed_variation: 0.12,
    speed_factor_variation: 0.08,
    curve_strength: 0.12,
    jitter_px: 3,
  },
};

export function classicalPath(
  start: Point,
  target: Point,
  profile: ProfileName,
  seed: number,
): Point[] {
  const config = MOUSE_PROFILES[profile];
  const distance = Math.hypot(target.x - start.x, target.y - start.y);
  if (distance === 0) return [{ ...start }];
  const count = Math.max(
    2,
    Math.min(
      120,
      Math.trunc(
        Math.min(
          config.max_path_points,
          Math.max(
            config.min_path_points,
            distance / config.target_segment_length_px,
          ),
        ),
      ),
    ),
  );
  const random = mulberry32(seed);
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const normal = { x: -dy / distance, y: dx / distance };
  const bend =
    (random() * 2 - 1) *
    config.curve_strength *
    Math.min(config.max_curve_px, distance);
  const cp1 = {
    x: start.x + dx * 0.25 + normal.x * bend,
    y: start.y + dy * 0.25 + normal.y * bend,
  };
  const cp2 = {
    x: start.x + dx * 0.75 + normal.x * bend,
    y: start.y + dy * 0.75 + normal.y * bend,
  };
  const points: Point[] = [];
  for (let index = 0; index < count; index++) {
    const t = index / (count - 1);
    const u = 1 - t;
    const wobble =
      Math.sin(Math.PI * t) * config.jitter_px * (random() * 2 - 1);
    points.push({
      x:
        u ** 3 * start.x +
        3 * u ** 2 * t * cp1.x +
        3 * u * t ** 2 * cp2.x +
        t ** 3 * target.x +
        normal.x * wobble,
      y:
        u ** 3 * start.y +
        3 * u ** 2 * t * cp1.y +
        3 * u * t ** 2 * cp2.y +
        t ** 3 * target.y +
        normal.y * wobble,
    });
  }
  points[points.length - 1] = { ...target };
  return points;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
