import type { RawInput, RawInputWorker } from "../cdp/relay";
import { DirectCdpSender, type DirectCdpOptions } from "./direct-cdp";
import { HumanKeyboard } from "./keyboard";
import { HumanMouse } from "./mouse";
import { OnnxMousePolicy } from "./policy";
import {
  CancellationError,
  type CdpSender,
  type Clock,
  type FallbackMetrics,
  type Point,
  type ProfileName,
  type RandomSource,
  sleepWithSignal,
  throwIfAborted,
} from "./types";

type Json = Record<string, unknown>;
type PendingPress = { point: Point; params: Json; sessionId?: string };

export type WorkerOptions = {
  sender?: CdpSender;
  browserWsUrl?: string;
  directCdp?: DirectCdpOptions;
  sessionId?: string;
  profile?: ProfileName;
  policy?: OnnxMousePolicy;
  policyOptions?: Parameters<typeof OnnxMousePolicy.load>[0];
  clock?: Clock;
  rng?: RandomSource;
  viewport?: { width: number; height: number };
  keyHoldMs?: number;
  interCharMs?: number;
};

export class BumblebeeWorker implements RawInputWorker {
  readonly metrics: FallbackMetrics = { classicalFallbacks: 0, reasons: {} };
  readonly mouse: HumanMouse;
  readonly keyboard: HumanKeyboard;
  private readonly sender: CdpSender;
  private readonly ownedSender?: DirectCdpSender;
  private readonly sessionId?: string;
  private readonly clock: Clock;
  private readonly rng: RandomSource;
  private readonly closeController = new AbortController();
  private policy?: OnnxMousePolicy;
  private pendingPress?: PendingPress;
  private closed = false;

  private constructor(
    options: WorkerOptions,
    sender: CdpSender,
    ownedSender?: DirectCdpSender,
  ) {
    this.sender = sender;
    this.ownedSender = ownedSender;
    this.sessionId = options.sessionId;
    this.clock = options.clock ?? { sleep: async () => {} };
    this.rng = options.rng ?? Math.random;
    this.policy = options.policy;
    this.mouse = new HumanMouse(this.sender, this.sessionId, {
      policy: this.policy,
      profile: options.profile,
      metrics: this.metrics,
      viewport: options.viewport,
    });
    this.keyboard = new HumanKeyboard(this.sender, this.sessionId, {
      clock: this.clock,
      keyHoldMs: options.keyHoldMs,
      interCharMs: options.interCharMs,
    });
  }

  static async create(options: WorkerOptions): Promise<BumblebeeWorker> {
    if (!options.sender && !options.browserWsUrl)
      throw new Error("BumblebeeWorker requires sender or browserWsUrl");
    const owned = options.sender
      ? undefined
      : new DirectCdpSender(options.browserWsUrl!, options.directCdp);
    const worker = new BumblebeeWorker(
      options,
      options.sender ?? owned!,
      owned,
    );
    if (!worker.policy) {
      try {
        worker.policy = await OnnxMousePolicy.load(options.policyOptions);
        worker.mouse.setPolicy(worker.policy);
      } catch (error) {
        worker.fallback(error instanceof Error ? error.name : "MODEL_LOAD");
      }
    }
    return worker;
  }

  async execute(event: RawInput, signal: AbortSignal): Promise<void> {
    if (this.closed) throw new CancellationError();
    const linked = linkSignals(signal, this.closeController.signal);
    try {
      throwIfAborted(linked.signal);
      const params = event.params;
      if (event.method === "Input.dispatchMouseEvent")
        await this.mouseEvent(params, event.sessionId, linked.signal);
      else if (event.method === "Input.dispatchKeyEvent")
        await this.keyboardEvent(params, event.sessionId, linked.signal);
      else if (event.method === "Input.insertText")
        await this.insertText(params, event.sessionId, linked.signal);
      else if (event.method === "Input.dispatchTouchEvent") {
        await this.sender.send(
          event.method,
          params,
          event.sessionId ?? this.sessionId,
        );
        throwIfAborted(linked.signal);
      }
    } catch (error) {
      if (error instanceof CancellationError || linked.signal.aborted)
        throw new CancellationError();
      this.fallback(error instanceof Error ? error.name : "INPUT_FAILURE");
      throw error;
    } finally {
      linked.dispose();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.pendingPress = undefined;
    this.closeController.abort();
    if (this.ownedSender) await this.ownedSender.close();
    else if (this.sender.close) await this.sender.close();
  }

  private async mouseEvent(
    params: Json,
    sessionId: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const type = typeof params.type === "string" ? params.type : "mouseMoved";
    const point = { x: number(params.x), y: number(params.y) };
    const targetSession = sessionId ?? this.sessionId;
    if (type === "mousePressed") {
      this.pendingPress = {
        point,
        params: { ...params },
        sessionId: targetSession,
      };
      return;
    }
    if (type === "mouseMoved") {
      if (this.pendingPress) {
        const pending = this.pendingPress;
        this.pendingPress = undefined;
        await this.mouse.move(pending.point, {}, pending.sessionId, signal);
        await this.mouse.dispatch(
          "mousePressed",
          pending.point,
          pending.params,
          pending.sessionId,
          signal,
        );
      }
      await this.mouse.move(
        point,
        mouseMoveParams(params),
        targetSession,
        signal,
      );
      return;
    }
    if (type === "mouseReleased") {
      if (this.pendingPress) {
        const pending = this.pendingPress;
        this.pendingPress = undefined;
        await this.mouse.move(pending.point, {}, pending.sessionId, signal);
        await sleepWithSignal(this.clock, range(this.rng, [80, 180]), signal);
        await this.mouse.dispatch(
          "mousePressed",
          pending.point,
          pending.params,
          pending.sessionId,
          signal,
        );
        await sleepWithSignal(this.clock, range(this.rng, [60, 140]), signal);
        await this.mouse.dispatch(
          "mouseReleased",
          pending.point,
          params,
          targetSession,
          signal,
        );
        return;
      }
      await this.mouse.move(
        point,
        mouseMoveParams(params),
        targetSession,
        signal,
      );
      await this.mouse.dispatch(
        "mouseReleased",
        point,
        params,
        targetSession,
        signal,
      );
      return;
    }
    if (type === "mouseWheel") {
      await this.mouse.move(
        point,
        mouseMoveParams(params),
        targetSession,
        signal,
      );
      await this.humanizedWheel(params, targetSession, signal);
      return;
    }
    await this.mouse.dispatch(type, point, params, targetSession, signal);
  }

  private async humanizedWheel(
    params: Json,
    sessionId: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const x = number(params.x);
    const y = number(params.y);
    const dx = number(params.deltaX);
    const dy = number(params.deltaY);
    const total = Math.max(Math.abs(dx), Math.abs(dy));
    if (total < 40) {
      await this.sender.send("Input.dispatchMouseEvent", params, sessionId);
      throwIfAborted(signal);
      return;
    }
    const vertical = Math.abs(dy) >= Math.abs(dx);
    const dominant = vertical ? dy : dx;
    const ratio = vertical ? (dy === 0 ? 0 : dx / dy) : dx === 0 ? 0 : dy / dx;
    const direction = dominant > 0 ? 1 : -1;
    const accel = integer(this.rng, 2, 3);
    const decel = integer(this.rng, 2, 3);
    let scrolled = 0;
    let outer = 0;
    let chunks = 0;
    let sleepBudget = 0;
    const emit = async (amount: number): Promise<void> => {
      throwIfAborted(signal);
      const amountX = vertical ? amount * ratio : amount;
      const amountY = vertical ? amount : amount * ratio;
      await this.sender.send(
        "Input.dispatchMouseEvent",
        {
          type: "mouseWheel",
          x,
          y,
          deltaX: amountX,
          deltaY: amountY,
          modifiers: number(params.modifiers),
        },
        sessionId,
      );
      throwIfAborted(signal);
    };
    const smooth = async (amount: number): Promise<void> => {
      let remaining = Math.abs(amount);
      const sign = amount > 0 ? 1 : -1;
      while (remaining > 0 && chunks < 256) {
        const chunk = Math.min(range(this.rng, [20, 40]), remaining);
        await emit(sign * chunk);
        remaining -= chunk;
        chunks += 1;
        if (remaining > 0) {
          const pause = range(this.rng, [8, 20]);
          sleepBudget += pause;
          if (sleepBudget > 5_000) throw new Error("wheel duration cap");
          await sleepWithSignal(this.clock, pause, signal);
        }
      }
      if (remaining > 0) throw new Error("wheel chunk cap");
    };
    while (scrolled < total && outer < 256) {
      const remaining = total - scrolled;
      let base =
        outer < accel
          ? range(this.rng, [80, 100])
          : remaining <= decel * 90
            ? range(this.rng, [60, 90])
            : range(this.rng, [80, 130]);
      base *= 1 + (this.rng() - 0.5) * 0.4;
      const step = Math.min(base, remaining);
      await smooth(direction * step);
      scrolled += step;
      outer += 1;
      if (scrolled < total) {
        const pause =
          outer < accel
            ? range(this.rng, [100, 200])
            : range(this.rng, [30, 80]);
        sleepBudget += pause;
        if (sleepBudget > 5_000) throw new Error("wheel duration cap");
        await sleepWithSignal(this.clock, pause, signal);
      }
    }
    if (scrolled < total) throw new Error("wheel step cap");
    await sleepWithSignal(this.clock, range(this.rng, [300, 600]), signal);
  }

  private async keyboardEvent(
    params: Json,
    sessionId: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const type = typeof params.type === "string" ? params.type : "";
    const key = typeof params.key === "string" ? params.key : "";
    const text = typeof params.text === "string" ? params.text : "";
    const modifiers = number(params.modifiers);
    if (
      (type === "keyDown" || type === "rawKeyDown") &&
      text.length === 1 &&
      modifiers === 0
    ) {
      await this.keyboard.typeCharacter(
        params,
        sessionId ?? this.sessionId,
        signal,
      );
      this.keyboard.swallowKeyUp(key);
      return;
    }
    if (type === "keyUp" && this.keyboard.consumeSwallowedKeyUp(key)) return;
    await this.keyboard.dispatch(params, sessionId ?? this.sessionId, signal);
  }

  private async insertText(
    params: Json,
    sessionId: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const text = typeof params.text === "string" ? params.text : "";
    if (text)
      await this.keyboard.typeText(text, sessionId ?? this.sessionId, signal);
  }

  private fallback(reason: string): void {
    this.metrics.classicalFallbacks += 1;
    this.metrics.reasons[reason] = (this.metrics.reasons[reason] ?? 0) + 1;
    console.warn(`[bumblebee] classical fallback: ${reason}`);
  }
}

function linkSignals(
  first: AbortSignal,
  second: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  first.addEventListener("abort", abort, { once: true });
  second.addEventListener("abort", abort, { once: true });
  if (first.aborted || second.aborted) controller.abort();
  return {
    signal: controller.signal,
    dispose: () => {
      first.removeEventListener("abort", abort);
      second.removeEventListener("abort", abort);
    },
  };
}
function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function range(rng: RandomSource, values: readonly [number, number]): number {
  return values[0] + rng() * (values[1] - values[0]);
}
function integer(rng: RandomSource, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1));
}
function mouseMoveParams(params: Json): Json {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([key]) => !["x", "y", "type", "deltaX", "deltaY"].includes(key),
    ),
  );
}
export type { Point };
