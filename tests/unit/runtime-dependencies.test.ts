import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AttentionService } from "../../src/core/attention/index.js";
import { ATTENTION_TOOL } from "../../src/mcp/registry.js";
import { createMcpRuntime } from "../../src/mcp/runtime.js";

type PackageManifest = {
  readonly dependencies?: Readonly<Record<string, string>>;
};

describe("runtime dependencies", () => {
  it("ships the CloakBrowser GeoIP peer as a production dependency", async () => {
    const manifest: PackageManifest = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    );

    expect(manifest.dependencies?.["mmdb-lib"]).toMatch(/^\^?3\./);
  });

  it("routes an injected attention service and shuts it down once", async () => {
    // Given
    let requests = 0;
    let attentionShutdowns = 0;
    let runtimeCloses = 0;
    const attentionService: AttentionService = {
      request: async () => {
        requests += 1;
        return {
          code: "ATTENTION_SUBMITTED",
          audio: "submitted",
          notification: "submitted",
        };
      },
      shutdown: async () => {
        attentionShutdowns += 1;
      },
    };
    const runtime = await createMcpRuntime({
      log: false,
      runtime: {
        lifecycle: {
          start: async () => undefined,
          stop: async () => undefined,
          forceStop: async () => undefined,
        },
        attentionService,
        browserRouter: { call: async () => ({ content: [] }) },
        browserTools: [],
        close: async () => {
          runtimeCloses += 1;
        },
      },
    });

    // When
    const result = await runtime.registry.call(ATTENTION_TOOL.name, {
      message: "Continue",
    });
    await runtime.close();
    await runtime.close();

    // Then
    expect(result).toMatchObject({
      structuredContent: { code: "ATTENTION_SUBMITTED" },
      isError: false,
    });
    expect(requests).toBe(1);
    expect(attentionShutdowns).toBe(1);
    expect(runtimeCloses).toBe(1);
  });
});
