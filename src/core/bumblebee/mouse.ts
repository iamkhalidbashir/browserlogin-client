import { classicalPath } from "./profiles";
import { SCREEN, DT_SECONDS, OnnxMousePolicy } from "./policy";
import { MOUSE_PROFILES } from "./profiles";
import {
  CancellationError,
  throwIfAborted,
  type CdpSender,
  type FallbackMetrics,
  type Point,
  type ProfileName,
  type Clock,
  type RandomSource,
  REAL_CLOCK,
  sleepWithSignal,
} from "./types";

export type MouseOptions = {
  policy?: OnnxMousePolicy;
  profile?: ProfileName;
  seed?: number;
  maxPoints?: number;
  metrics?: FallbackMetrics;
  viewport?: { width: number; height: number };
  clock?: Clock;
  rng?: RandomSource;
};

export class HumanMouse {
  private position: Point = { x: 0, y: 0 };
  readonly metrics: FallbackMetrics;
  private readonly profile: ProfileName;
  private readonly maxPoints: number;
  private readonly viewport: { width: number; height: number };
  private readonly clock: Clock;
  private readonly rng: RandomSource;
  private policy?: OnnxMousePolicy;

  constructor(
    private readonly sender: CdpSender,
    private readonly sessionId: string | undefined,
    private readonly options: MouseOptions = {},
  ) {
    this.profile = options.profile ?? "default";
    this.maxPoints = Math.max(2, Math.min(256, options.maxPoints ?? 128));
    this.metrics = options.metrics ?? { classicalFallbacks: 0, reasons: {} };
    this.viewport = options.viewport ?? {
      width: SCREEN.width,
      height: SCREEN.height,
    };
    this.clock = options.clock ?? REAL_CLOCK;
    this.rng = options.rng ?? Math.random;
    this.policy = options.policy;
  }

  setPolicy(policy: OnnxMousePolicy | undefined): void {
    this.policy = policy;
  }

  get current(): Point {
    return { ...this.position };
  }

  get actualViewport(): { width: number; height: number } {
    return { ...this.viewport };
  }

  async move(
    target: Point,
    params: Record<string, unknown> = {},
    sessionId = this.sessionId,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const destination = clamp(target, this.viewport);
    const start = this.position;
    if (Math.hypot(destination.x - start.x, destination.y - start.y) <= 1) {
      await this.dispatch("mouseMoved", destination, params, sessionId, signal);
      return;
    }
    let points: Point[];
    try {
      points = this.policy
        ? await this.policy.rollout(
            toModel(start, this.viewport),
            toModel(destination, this.viewport),
            this.options.seed ?? 0,
          )
        : classicalPath(
            toModel(start, this.viewport),
            toModel(destination, this.viewport),
            this.profile,
            this.options.seed ?? 0,
          );
      points = points.map((point) => fromModel(point, this.viewport));
      throwIfAborted(signal);
      if (!validPath(points, start, destination, this.maxPoints, this.viewport))
        throw new Error("invalid trajectory");
    } catch (error) {
      if (error instanceof CancellationError) throw error;
      this.fallback(error instanceof Error ? error.message : "trajectory");
      points = [start, destination];
    }
    points[points.length - 1] = destination;
    let elapsed = 0;
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      await this.dispatch("mouseMoved", point, params, sessionId, signal);
      if (index < points.length - 1) {
        const delay = segmentDelay(
          this.profile,
          this.rng,
          points[index],
          points[index + 1],
          index,
          points.length,
          Boolean(this.policy),
        );
        const bounded = Math.min(delay, Math.max(0, 30_000 - elapsed));
        elapsed += bounded;
        await sleepWithSignal(this.clock, bounded, signal);
      }
    }
  }

  async dispatch(
    type: string,
    point: Point,
    params: Record<string, unknown> = {},
    sessionId = this.sessionId,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const safe = clamp(point, this.viewport);
    await this.sender.send(
      "Input.dispatchMouseEvent",
      { ...params, type, x: safe.x, y: safe.y },
      sessionId,
    );
    throwIfAborted(signal);
    if (
      type === "mouseMoved" ||
      type === "mousePressed" ||
      type === "mouseReleased"
    )
      this.position = safe;
  }

  private fallback(reason: string): void {
    this.metrics.classicalFallbacks += 1;
    this.metrics.reasons[reason] = (this.metrics.reasons[reason] ?? 0) + 1;
    console.warn(`[bumblebee] classical mouse fallback: ${reason}`);
  }
}

function segmentDelay(
  profileName: ProfileName,
  rng: RandomSource,
  start: Point,
  end: Point,
  index: number,
  count: number,
  rl: boolean,
): number {
  if (rl) return DT_SECONDS * 1000;
  const profile = MOUSE_PROFILES[profileName];
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const t = count <= 1 ? 0 : index / (count - 1);
  const variation = profile.speed_factor_variation
    ? (rng() * 2 - 1) * profile.speed_factor_variation
    : 0;
  const factor = Math.min(
    profile.max_speed_factor,
    Math.max(
      profile.min_speed_factor,
      1.15 - 0.45 * Math.sin(Math.PI * t) + variation,
    ),
  );
  return Math.min(
    1000,
    (distance / Math.max(1, profile.speed_px_s * factor)) * 1000,
  );
}

function clamp(
  point: Point,
  viewport: { width: number; height: number },
): Point {
  return {
    x: Math.min(
      Math.max(0, viewport.width - 1),
      Math.max(0, Number.isFinite(point.x) ? point.x : 0),
    ),
    y: Math.min(
      Math.max(0, viewport.height - 1),
      Math.max(0, Number.isFinite(point.y) ? point.y : 0),
    ),
  };
}
function toModel(
  point: Point,
  viewport: { width: number; height: number },
): Point {
  return {
    x: (point.x * SCREEN.width) / Math.max(1, viewport.width),
    y: (point.y * SCREEN.height) / Math.max(1, viewport.height),
  };
}
function fromModel(
  point: Point,
  viewport: { width: number; height: number },
): Point {
  return {
    x: (point.x * viewport.width) / SCREEN.width,
    y: (point.y * viewport.height) / SCREEN.height,
  };
}
function validPath(
  points: Point[],
  start: Point,
  target: Point,
  maxPoints: number,
  viewport: { width: number; height: number },
): boolean {
  return (
    points.length >= 2 &&
    points.length <= maxPoints &&
    points.every(
      (point) =>
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        point.x >= 0 &&
        point.y >= 0 &&
        point.x < viewport.width &&
        point.y < viewport.height,
    ) &&
    Math.hypot(points[0].x - start.x, points[0].y - start.y) <= 1e-5 &&
    Math.hypot(
      points[points.length - 1].x - target.x,
      points[points.length - 1].y - target.y,
    ) <= 1e-5
  );
}
