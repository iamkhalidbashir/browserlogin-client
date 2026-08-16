import type { RawInput, RawInputWorker } from "../cdp/relay";
import { HumanKeyboard } from "./keyboard";
import { HumanMouse } from "./mouse";
import { OnnxMousePolicy } from "./policy";
import type { CdpSender, FallbackMetrics, Point, ProfileName } from "./types";

export type WorkerOptions = {
  sender: CdpSender;
  sessionId?: string;
  profile?: ProfileName;
  policy?: OnnxMousePolicy;
  policyOptions?: Parameters<typeof OnnxMousePolicy.load>[0];
  clock?: { sleep(ms: number): Promise<void> };
};

export class BumblebeeWorker implements RawInputWorker {
  readonly metrics: FallbackMetrics = { classicalFallbacks: 0, reasons: {} };
  readonly mouse: HumanMouse;
  readonly keyboard: HumanKeyboard;
  private readonly sender: CdpSender;
  private readonly sessionId?: string;
  private policy?: OnnxMousePolicy;

  private constructor(options: WorkerOptions) {
    this.sender = options.sender;
    this.sessionId = options.sessionId;
    this.policy = options.policy;
    this.mouse = new HumanMouse(this.sender, this.sessionId, {
      policy: this.policy,
      profile: options.profile,
      metrics: this.metrics,
    });
    this.keyboard = new HumanKeyboard(this.sender, this.sessionId, {
      clock: options.clock,
    });
  }

  static async create(options: WorkerOptions): Promise<BumblebeeWorker> {
    const worker = new BumblebeeWorker(options);
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
    if (signal.aborted) return;
    const params = event.params;
    try {
      if (event.method === "Input.dispatchMouseEvent")
        await this.mouseEvent(params, event.sessionId);
      else if (event.method === "Input.dispatchKeyEvent")
        await this.keyboardEvent(params, event.sessionId);
      else if (event.method === "Input.insertText")
        await this.insertText(params, event.sessionId);
      else
        await this.sender.send(
          event.method,
          params,
          event.sessionId ?? this.sessionId,
        );
    } catch (error) {
      this.fallback(error instanceof Error ? error.name : "INPUT_FAILURE");
      await this.sender.send(
        event.method,
        params,
        event.sessionId ?? this.sessionId,
      );
    }
  }

  private async mouseEvent(
    params: Record<string, unknown>,
    sessionId?: string,
  ): Promise<void> {
    const type = typeof params.type === "string" ? params.type : "mouseMoved";
    const point = { x: number(params.x), y: number(params.y) };
    if (type === "mouseMoved") {
      await this.mouse.move(
        point,
        withoutCoordinates(params),
        sessionId ?? this.sessionId,
      );
      return;
    }
    const moveParams =
      type === "mouseWheel"
        ? mouseMoveParams(params)
        : { ...withoutCoordinates(params), type: "mouseMoved" };
    await this.mouse.move(point, moveParams, sessionId ?? this.sessionId);
    await this.mouse.dispatch(
      type,
      point,
      withoutCoordinates(params),
      sessionId ?? this.sessionId,
    );
  }

  private async keyboardEvent(
    params: Record<string, unknown>,
    sessionId?: string,
  ): Promise<void> {
    await this.keyboard.dispatch(params, sessionId ?? this.sessionId);
  }

  private async insertText(
    params: Record<string, unknown>,
    sessionId?: string,
  ): Promise<void> {
    const text = typeof params.text === "string" ? params.text : "";
    if (!text) return;
    await this.keyboard.typeText(text, sessionId ?? this.sessionId);
  }

  private fallback(reason: string): void {
    this.metrics.classicalFallbacks += 1;
    this.metrics.reasons[reason] = (this.metrics.reasons[reason] ?? 0) + 1;
    console.warn(`[bumblebee] classical fallback: ${reason}`);
  }
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function withoutCoordinates(
  params: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([key]) => key !== "x" && key !== "y" && key !== "type",
    ),
  );
}
function mouseMoveParams(
  params: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(withoutCoordinates(params)).filter(
      ([key]) => key !== "deltaX" && key !== "deltaY",
    ),
  );
}
export type { Point };
