import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OnnxMousePolicy } from "../../src/core/bumblebee/policy";

type Corpus = {
  seed: number;
  cases: { observation: number[]; mean: number[]; log_std: number[] }[];
};
const root = resolve(import.meta.dirname, "../..");

describe("Bumblebee ONNX fidelity", () => {
  it("matches the Python corpus with finite outputs", async () => {
    const corpus = JSON.parse(
      readFileSync(resolve(root, "tests/fixtures/onnx-corpus.json"), "utf8"),
    ) as Corpus;
    const policy = await OnnxMousePolicy.load();
    let max = 0;
    let sum = 0;
    let count = 0;
    let nonFinite = 0;
    for (const item of corpus.cases) {
      const output = await policy.infer(new Float32Array(item.observation));
      const actual = [...output.mean, ...output.logStd];
      const expected = [...item.mean, ...item.log_std];
      for (let index = 0; index < actual.length; index++) {
        if (!Number.isFinite(actual[index])) nonFinite += 1;
        const error = Math.abs(actual[index] - expected[index]);
        max = Math.max(max, error);
        sum += error;
        count += 1;
      }
    }
    const metrics = {
      max,
      mean: sum / count,
      nonFinite,
      corpus: corpus.cases.length,
      hash: createHash("sha256")
        .update(
          readFileSync(resolve(root, "resources/models/sac_mouse_v2.onnx")),
        )
        .digest("hex"),
    };
    console.log(JSON.stringify(metrics));
    expect(metrics.corpus).toBeGreaterThanOrEqual(1000);
    expect(metrics.max).toBeLessThanOrEqual(1e-5);
    expect(metrics.mean).toBeLessThanOrEqual(1e-6);
    expect(metrics.nonFinite).toBe(0);
  }, 180_000);
});
