import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { createF2VendorRuntime } from "../../src/core/browser-tools/vendor.js";

const fixture = fileURLToPath(
  new URL("../fixtures/fake-vendor-child.mjs", import.meta.url),
);

async function withEnv<T>(
  values: Record<string, string | undefined>,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await operation();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("f2 vendor stdio subprocess", () => {
  test("captures exact argv/env, initializes, translates calls, and closes", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-vendor-"));
    const capture = join(root, "capture.jsonl");
    const stderr: string[] = [];
    try {
      const runtime = await withEnv(
        { FAKE_VENDOR_CAPTURE: capture, FAKE_VENDOR_MODE: undefined },
        () =>
          createF2VendorRuntime({
            profileId: "p1",
            relayCdpUrl: "ws://127.0.0.1:3000/token",
            nodeCommand: process.execPath,
            cliPath: fixture,
            startupTimeoutMs: 1_000,
            callTimeoutMs: 1_000,
            closeTimeoutMs: 1_000,
            onStderr: (text) => stderr.push(text),
          }),
      );
      expect((await runtime.callTool("browser_snapshot", {})).isError).not.toBe(
        true,
      );
      await runtime.callTool("browser_tabs", {
        action: "new",
        url: "about:blank",
      });
      await runtime.callTool("browser_run_code_unsafe", {
        code: "async () => 1",
      });
      const started = Date.now();
      await runtime.close();
      expect(Date.now() - started).toBeLessThan(10_000);

      const captured = JSON.parse((await readFile(capture, "utf8")).trim());
      expect(captured.argv).toEqual([
        fixture,
        "--cdp-endpoint",
        "ws://127.0.0.1:3000/token",
        "--timeout-action",
        "30000",
        "--timeout-navigation",
        "90000",
      ]);
      expect(captured.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).toBe("1");
      expect(stderr.join("\n")).toContain("Bearer [REDACTED]");
      expect(stderr.join("\n")).not.toContain("test-secret");
      expect(stderr.join("\n")).not.toContain("private-value");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("maps child crash and timeout to bounded generic failures", async () => {
    await expect(
      withEnv({ FAKE_VENDOR_MODE: "crash" }, () =>
        createF2VendorRuntime({
          profileId: "crash",
          relayCdpUrl: "ws://127.0.0.1:3000/token",
          nodeCommand: process.execPath,
          cliPath: fixture,
          startupTimeoutMs: 500,
          closeTimeoutMs: 500,
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withEnv({ FAKE_VENDOR_MODE: "timeout" }, () =>
        createF2VendorRuntime({
          profileId: "timeout",
          relayCdpUrl: "ws://127.0.0.1:3000/token",
          nodeCommand: process.execPath,
          cliPath: fixture,
          startupTimeoutMs: 100,
          closeTimeoutMs: 500,
        }),
      ),
    ).rejects.toThrow();

    const runtime = await withEnv({ FAKE_VENDOR_MODE: "call-timeout" }, () =>
      createF2VendorRuntime({
        profileId: "call-timeout",
        relayCdpUrl: "ws://127.0.0.1:3000/token",
        nodeCommand: process.execPath,
        cliPath: fixture,
        startupTimeoutMs: 500,
        callTimeoutMs: 100,
        closeTimeoutMs: 500,
      }),
    );
    await expect(runtime.callTool("browser_snapshot", {})).rejects.toThrow();
    await runtime.close();
  });
});
