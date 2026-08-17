import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { SOURCE_MANIFEST_TOOL_NAMES } from "../../src/core/browser-tools/manifest.js";
import { createF2VendorRuntime } from "../../src/core/browser-tools/vendor.js";

const fixture = fileURLToPath(
  new URL("../fixtures/fake-vendor-child.mjs", import.meta.url),
);
const execFileAsync = promisify(execFile);

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
  test("uses a packaged Bun helper with an empty PATH and no system Node", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-vendor-helper-"));
    const helper = join(root, "browserlogin-browser-tools-helper");
    const capture = join(root, "capture.jsonl");
    try {
      await execFileAsync(
        process.env.BROWSERLOGIN_BUN_PATH ?? "bun",
        ["build", "--compile", fixture, "--outfile", helper],
        { cwd: process.cwd() },
      );
      const runtime = await withEnv(
        {
          PATH: "",
          BROWSERLOGIN_BROWSER_TOOLS_HELPER: helper,
        },
        () =>
          createF2VendorRuntime({
            profileId: "packaged-helper",
            relayCdpUrl: "ws://127.0.0.1:3000/token",
            startupTimeoutMs: 5_000,
            closeTimeoutMs: 1_000,
            extraEnv: { FAKE_VENDOR_CAPTURE: capture },
          }),
      );
      await runtime.close();
      const captured = JSON.parse((await readFile(capture, "utf8")).trim());
      const endpointIndex = captured.argv.indexOf("--cdp-endpoint");
      expect(endpointIndex).toBeGreaterThanOrEqual(0);
      expect(captured.argv[endpointIndex + 1]).toBe(
        "ws://127.0.0.1:3000/token",
      );
      expect(captured.argv).not.toContain(fixture);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("captures exact argv/env, initializes, translates calls, and closes", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-vendor-"));
    const capture = join(root, "capture.jsonl");
    const stderr: string[] = [];
    try {
      const runtime = await withEnv(
        {
          BROWSERLOGIN_API_KEY: "parent-secret",
          CLOAKBROWSER_API_KEY: "parent-secret",
          CLOAKBROWSER_LICENSE_KEY: "parent-secret",
          CLOAKBROWSER_LICENSE_API: "http://user:password@example.invalid",
          HTTP_PROXY: "http://proxy-user:proxy-password@example.invalid:8080",
          CUSTOM_SECRET: "parent-secret",
          CUSTOM_TOKEN: "parent-secret",
        },
        () =>
          createF2VendorRuntime({
            profileId: "p1",
            relayCdpUrl: "ws://127.0.0.1:3000/token",
            nodeCommand: process.execPath,
            cliPath: fixture,
            startupTimeoutMs: 1_000,
            callTimeoutMs: 1_000,
            closeTimeoutMs: 1_000,
            extraEnv: { FAKE_VENDOR_CAPTURE: capture },
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
      const capturedText = await readFile(capture, "utf8");
      expect(capturedText).not.toContain("BROWSERLOGIN_API_KEY");
      expect(capturedText).not.toContain("CLOAKBROWSER_LICENSE_KEY");
      expect(capturedText).not.toContain("HTTP_PROXY");
      expect(capturedText).not.toContain("parent-secret");
      expect(stderr.join("\n")).toContain("Bearer [REDACTED]");
      expect(stderr.join("\n")).not.toContain("test-secret");
      expect(stderr.join("\n")).not.toContain("private-value");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("maps child crash and timeout to bounded generic failures", async () => {
    await expect(
      createF2VendorRuntime({
        profileId: "crash",
        relayCdpUrl: "ws://127.0.0.1:3000/token",
        nodeCommand: process.execPath,
        cliPath: fixture,
        startupTimeoutMs: 500,
        closeTimeoutMs: 500,
        extraEnv: { FAKE_VENDOR_MODE: "crash" },
      }),
    ).rejects.toThrow();

    await expect(
      createF2VendorRuntime({
        profileId: "timeout",
        relayCdpUrl: "ws://127.0.0.1:3000/token",
        nodeCommand: process.execPath,
        cliPath: fixture,
        startupTimeoutMs: 100,
        closeTimeoutMs: 500,
        extraEnv: { FAKE_VENDOR_MODE: "timeout" },
      }),
    ).rejects.toThrow();

    const runtime = await createF2VendorRuntime({
      profileId: "call-timeout",
      relayCdpUrl: "ws://127.0.0.1:3000/token",
      nodeCommand: process.execPath,
      cliPath: fixture,
      startupTimeoutMs: 500,
      callTimeoutMs: 100,
      closeTimeoutMs: 500,
      extraEnv: { FAKE_VENDOR_MODE: "call-timeout" },
    });
    await expect(runtime.callTool("browser_snapshot", {})).rejects.toThrow();
    await runtime.close();

    await expect(
      createF2VendorRuntime({
        profileId: "sensitive",
        relayCdpUrl: "ws://127.0.0.1:3000/token",
        nodeCommand: process.execPath,
        cliPath: fixture,
        extraEnv: { CLOAKBROWSER_API_KEY: "must-reject" },
      }),
    ).rejects.toThrow("unsafe child environment key");
  });

  test("rejects startup when a required direct capability is absent", async () => {
    await expect(
      createF2VendorRuntime({
        profileId: "missing-find",
        relayCdpUrl: "ws://127.0.0.1:3000/token",
        nodeCommand: process.execPath,
        cliPath: fixture,
        startupTimeoutMs: 500,
        closeTimeoutMs: 500,
        extraEnv: { FAKE_VENDOR_MODE: "missing-find" },
      }),
    ).rejects.toThrow();
  });

  test("lists capabilities from the installed 0.0.79 CLI against idle local CDP", async () => {
    const httpServer = createServer();
    const server = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
    httpServer.on("upgrade", (request, socket, head) => {
      server.handleUpgrade(request, socket, head, (client) => {
        server.emit("connection", client, request);
      });
    });
    await new Promise<void>((resolve) =>
      httpServer.listen(0, "127.0.0.1", resolve),
    );
    const address = httpServer.address();
    if (!address || typeof address === "string")
      throw new Error("missing port");
    server.on("connection", (socket: WebSocket) =>
      socket.on("error", () => undefined),
    );
    let names: string[] = [];
    try {
      const runtime = await createF2VendorRuntime({
        profileId: "installed-cli",
        relayCdpUrl: `ws://127.0.0.1:${address.port}/idle-cdp`,
        nodeCommand: process.execPath,
        startupTimeoutMs: 5_000,
        closeTimeoutMs: 1_000,
        onToolsList: (listed) => {
          names = listed;
        },
      });
      await runtime.close();
      expect(names).toEqual([...SOURCE_MANIFEST_TOOL_NAMES]);
    } finally {
      server.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });
});
