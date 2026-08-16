import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ort from "onnxruntime-web/wasm";

const defaultModel = resolve(import.meta.dir, "../resources/models/sac_mouse_v2.onnx");
const defaultWasm = resolve(import.meta.dir, "../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm");
const expectedHash = "55c7dcccfbf436bf49d2f7f8e1a5b06bdeba5e23d2ec55090a8f0b099fd2930b";

type Options = {
  model: string;
  wasm: string;
  corruptModel: boolean;
};

function argumentValue(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? "";
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  return {
    model: resolve(argumentValue(args, "--model", defaultModel)),
    wasm: resolve(argumentValue(args, "--wasm", defaultWasm)),
    corruptModel: args.includes("--corrupt-model"),
  };
}

function readAsset(path: string, label: string): Uint8Array {
  try {
    const bytes = new Uint8Array(readFileSync(path));
    if (bytes.byteLength === 0) {
      throw new Error("empty file");
    }
    return bytes;
  } catch (error) {
    throw new Error(`MODEL_ASSET_MISSING:${label}:${path}:searched=${path}:${String(error)}`);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function finiteFloat32(data: unknown, name: string, expectedSize: number): number[] {
  if (!(data instanceof Float32Array) || data.length !== expectedSize || !data.every(Number.isFinite)) {
    throw new Error(`MODEL_OUTPUT_INVALID:${name}:expected=float32[${expectedSize}]`);
  }
  return Array.from(data);
}

async function main(): Promise<void> {
  const options = parseArgs();
  let model = readAsset(options.model, "model");
  const wasm = readAsset(options.wasm, "wasm");
  if (options.corruptModel) {
    model = new Uint8Array(model);
    model[0] ^= 0xff;
  }
  const actualHash = sha256(model);
  if (actualHash !== expectedHash) {
    throw new Error(`MODEL_HASH_MISMATCH:expected=${expectedHash}:actual=${actualHash}`);
  }

  let fetches = 0;
  const originalFetch = globalThis.fetch;
  const blockedFetch: typeof fetch = Object.assign(
    async (..._args: Parameters<typeof fetch>): Promise<Response> => {
      void _args;
      fetches += 1;
      throw new Error("TASK6_NETWORK_FETCH_BLOCKED");
    },
    { preconnect: originalFetch.preconnect },
  );
  globalThis.fetch = blockedFetch;

  try {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmBinary = wasm;
    const started = performance.now();
    const session = await ort.InferenceSession.create(model, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    const input = new ort.Tensor("float32", new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), [1, 10]);
    const result = await session.run({ observation: input });
    const mean = result.mean;
    const logStd = result.log_std;
    if (!mean || !logStd || mean.dims.join(",") !== "1,2" || logStd.dims.join(",") !== "1,2") {
      throw new Error("MODEL_OUTPUT_INVALID:names_or_shapes:expected=mean[1,2],log_std[1,2]");
    }
    const elapsedMs = Number((performance.now() - started).toFixed(3));
    const output = {
      loaded: true,
      ms: elapsedMs,
      source: "onnxruntime-web-wasm",
      model: options.model,
      wasm: options.wasm,
      fetches,
      modelSha256: actualHash,
      mean: finiteFloat32(mean.data, "mean", 2),
      log_std: finiteFloat32(logStd.data, "log_std", 2),
    };
    if (fetches !== 0) {
      throw new Error(`TASK6_NETWORK_FETCH_COUNT:${fetches}`);
    }
    console.log(JSON.stringify(output));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
