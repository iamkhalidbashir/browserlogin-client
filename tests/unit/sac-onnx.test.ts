import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type CorpusCase = {
  observation: number[];
  mean: number[];
  log_std: number[];
};

type Manifest = {
  artifact: { sha256: string; opset: number };
  corpus: { cases: number; sha256: string };
  observations: { size: number; ordering: string[] };
  actions: { size: number; bounds: [number, number] };
  log_std_clip: { min: number; max: number };
};

const root = resolve(import.meta.dirname, "../..");
const modelPath = resolve(root, "resources/models/sac_mouse_v2.onnx");
const manifestPath = resolve(
  root,
  "resources/models/sac_mouse_v2.manifest.json",
);
const corpusPath = resolve(root, "tests/fixtures/onnx-corpus.json");

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("SAC ONNX artifact", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as {
    seed: number;
    cases: CorpusCase[];
  };

  it("has a complete fixed contract and matching artifact hash", () => {
    expect(manifest.artifact.opset).toBe(17);
    expect(manifest.observations.size).toBe(10);
    expect(manifest.observations.ordering).toHaveLength(10);
    expect(manifest.actions.size).toBe(2);
    expect(manifest.actions.bounds).toEqual([-1, 1]);
    expect(manifest.log_std_clip.min).toBe(-20);
    expect(manifest.log_std_clip.max).toBe(2);
    expect(sha256(readFileSync(modelPath))).toBe(manifest.artifact.sha256);
  });

  it("contains at least 1000 finite seeded Python output cases", () => {
    expect(corpus.seed).toBe(20260816);
    expect(corpus.cases.length).toBeGreaterThanOrEqual(1000);
    expect(corpus.cases.length).toBe(manifest.corpus.cases);
    expect(sha256(readFileSync(corpusPath))).toBe(manifest.corpus.sha256);
    for (const item of corpus.cases) {
      expect(item.observation).toHaveLength(10);
      expect(item.mean).toHaveLength(2);
      expect(item.log_std).toHaveLength(2);
      expect(item.observation.every(Number.isFinite)).toBe(true);
      expect(item.mean.every(Number.isFinite)).toBe(true);
      expect(item.log_std.every(Number.isFinite)).toBe(true);
    }
  });
});
