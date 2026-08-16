import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Bumblebee compiled adjacent assets", () => {
  it("loads copied model and WASM without runtime network assets", () => {
    const root = resolve(import.meta.dirname, "../..");
    const temp = mkdtempSync(resolve(tmpdir(), "task20-bumblebee-"));
    const model = resolve(temp, "sac_mouse_v2.onnx");
    const wasm = resolve(temp, "ort-wasm-simd-threaded.wasm");
    const binary = resolve(temp, "bumblebee-assets");
    try {
      copyFileSync(resolve(root, "resources/models/sac_mouse_v2.onnx"), model);
      copyFileSync(
        resolve(root, "resources/models/ort-wasm-simd-threaded.wasm"),
        wasm,
      );
      execFileSync(
        "bun",
        [
          "build",
          "--compile",
          "tests/fixtures/bumblebee-asset-child.ts",
          "--outfile",
          binary,
        ],
        { cwd: root, timeout: 180_000, stdio: "pipe" },
      );
      const output = execFileSync(binary, [model, wasm], {
        cwd: root,
        timeout: 180_000,
        encoding: "utf8",
        env: {
          ...process.env,
          HTTPS_PROXY: "http://127.0.0.1:9",
          HTTP_PROXY: "http://127.0.0.1:9",
        },
      });
      const result = JSON.parse(output.trim()) as {
        loaded: boolean;
        modelBytes: number;
        wasmBytes: number;
      };
      expect(result).toMatchObject({ loaded: true, modelBytes: 1083258 });
      expect(result.wasmBytes).toBeGreaterThan(100_000);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }, 180_000);
});
