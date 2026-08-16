import type { RawInput } from "../cdp/relay";

export type Point = { x: number; y: number };
export type Button = "none" | "left" | "middle" | "right";
export type ProfileName = "default" | "precise" | "fast" | "natural" | "messy";
export type CdpSender = {
  send(
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ): Promise<void> | void;
};
export type Clock = { sleep(ms: number): Promise<void> };
export type WorkerInput = RawInput;
export type FallbackMetrics = {
  classicalFallbacks: number;
  reasons: Record<string, number>;
};
