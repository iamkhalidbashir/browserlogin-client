import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as ort from "onnxruntime-web/wasm";

import type { Point } from "./types";

export const SCREEN = { width: 4096, height: 2304 } as const;
export const MAX_STEPS = 96;
export const DT_SECONDS = 1 / 120;
export const MAX_VELOCITY = 6500;
export const TARGET_RADIUS = 8;
export const MODEL_SHA256 =
  "55c7dcccfbf436bf49d2f7f8e1a5b06bdeba5e23d2ec55090a8f0b099fd2930b";

export class ModelAssetError extends Error {
  constructor(
    public readonly code: "MODEL_ASSET_MISSING" | "MODEL_HASH_MISMATCH",
    message: string,
  ) {
    super(`${code}:${message}`);
    this.name = code;
  }
}

export type PolicyOptions = {
  modelPath?: string;
  wasmPath?: string;
  modelBytes?: Uint8Array;
  wasmBytes?: Uint8Array;
  session?: ort.InferenceSession;
};

const defaultModel = resolve(
  import.meta.dirname,
  "../../../resources/models/sac_mouse_v2.onnx",
);
const defaultWasm = resolve(
  import.meta.dirname,
  "../../../resources/models/ort-wasm-simd-threaded.wasm",
);

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

async function asset(path: string, label: string): Promise<Uint8Array> {
  try {
    const bytes = new Uint8Array(await readFile(path));
    if (!bytes.byteLength) throw new Error("empty file");
    return bytes;
  } catch (error) {
    throw new ModelAssetError(
      "MODEL_ASSET_MISSING",
      `${label}:${path}:${String(error)}`,
    );
  }
}

function finiteOutput(
  value: ort.Tensor | undefined,
  name: string,
): Float32Array {
  if (
    !value ||
    value.dims.join(",") !== "1,2" ||
    !(value.data instanceof Float32Array) ||
    value.data.length !== 2 ||
    !value.data.every(Number.isFinite)
  ) {
    throw new Error(`MODEL_OUTPUT_INVALID:${name}`);
  }
  return value.data;
}

export class OnnxMousePolicy {
  private constructor(private readonly session: ort.InferenceSession) {}

  static async load(options: PolicyOptions = {}): Promise<OnnxMousePolicy> {
    const model =
      options.modelBytes ??
      (await asset(options.modelPath ?? defaultModel, "model"));
    const wasm =
      options.wasmBytes ??
      (await asset(options.wasmPath ?? defaultWasm, "wasm"));
    const actual = sha256(model);
    if (actual !== MODEL_SHA256)
      throw new ModelAssetError(
        "MODEL_HASH_MISMATCH",
        `expected=${MODEL_SHA256}:actual=${actual}`,
      );
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmBinary = wasm;
    return new OnnxMousePolicy(
      options.session ??
        (await ort.InferenceSession.create(model, {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all",
        })),
    );
  }

  async infer(
    observation: Float32Array,
  ): Promise<{ mean: Float32Array; logStd: Float32Array }> {
    if (observation.length !== 10 || !observation.every(Number.isFinite))
      throw new Error("MODEL_INPUT_INVALID:observation");
    const result = await this.session.run({
      observation: new ort.Tensor("float32", observation, [1, 10]),
    });
    return {
      mean: finiteOutput(result.mean, "mean"),
      logStd: finiteOutput(result.log_std, "log_std"),
    };
  }

  async rollout(
    start: Point,
    target: Point,
    seed: number,
    deterministic = false,
  ): Promise<Point[]> {
    let position = { ...start };
    let previous = { x: 0, y: 0 };
    const points = [{ ...position }];
    const random = mulberry32(seed);
    for (let step = 0; step < MAX_STEPS; step++) {
      const observation = makeObservation(position, target, previous, step);
      const { mean, logStd } = await this.infer(observation);
      const action = [0, 1].map((index) =>
        Math.tanh(
          mean[index] +
            Math.exp(Math.min(2, Math.max(-20, logStd[index]))) *
              (deterministic ? 0 : gaussian(random)),
        ),
      );
      let ax = Math.max(-1, Math.min(1, action[0]));
      let ay = Math.max(-1, Math.min(1, action[1]));
      const norm = Math.hypot(ax, ay);
      if (norm > 1) {
        ax /= norm;
        ay /= norm;
      }
      previous = { x: ax * MAX_VELOCITY, y: ay * MAX_VELOCITY };
      position = {
        x: Math.min(
          SCREEN.width - 1,
          Math.max(0, position.x + previous.x * DT_SECONDS),
        ),
        y: Math.min(
          SCREEN.height - 1,
          Math.max(0, position.y + previous.y * DT_SECONDS),
        ),
      };
      if (
        Math.hypot(position.x - target.x, position.y - target.y) <=
        TARGET_RADIUS
      ) {
        points.push({ ...target });
        return points;
      }
      points.push({ ...position });
    }
    return points;
  }
}

export function makeObservation(
  position: Point,
  target: Point,
  previous: Point,
  step: number,
): Float32Array {
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  return new Float32Array([
    position.x / SCREEN.width,
    position.y / SCREEN.height,
    target.x / SCREEN.width,
    target.y / SCREEN.height,
    dx / SCREEN.width,
    dy / SCREEN.height,
    Math.hypot(dx, dy) / Math.hypot(SCREEN.width, SCREEN.height),
    previous.x / MAX_VELOCITY,
    previous.y / MAX_VELOCITY,
    step / MAX_STEPS,
  ]);
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
function gaussian(random: () => number): number {
  return (
    Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, random()))) *
    Math.cos(2 * Math.PI * random())
  );
}
export { defaultModel, defaultWasm, sha256 };
