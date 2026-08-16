import { readFile } from "node:fs/promises";
import { OnnxMousePolicy } from "../../src/core/bumblebee/policy";

const model = process.argv[2];
const wasm = process.argv[3];
if (!model || !wasm) throw new Error("asset paths required");
const policy = await OnnxMousePolicy.load({ modelPath: model, wasmPath: wasm });
const output = await policy.infer(new Float32Array(10));
console.log(
  JSON.stringify({
    loaded: true,
    mean: [...output.mean],
    logStd: [...output.logStd],
    modelBytes: (await readFile(model)).byteLength,
    wasmBytes: (await readFile(wasm)).byteLength,
  }),
);
