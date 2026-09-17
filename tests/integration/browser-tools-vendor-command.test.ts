import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  resolveVendorCommand,
  vendorScriptPath,
} from "../../src/core/browser-tools/vendor-command.js";

const execute = promisify(execFile);

describe("browser tools vendor command", () => {
  it("runs the packaged script with Electrobun's Bun runtime", () => {
    // Given: Electrobun's Resources/app/bun and Resources/app/vendor layout.
    const root = join(tmpdir(), "browserlogin-electrobun-package");
    const moduleDir = join(root, "Resources", "app", "bun");
    const script = join(root, "Resources", "app", "vendor", vendorScriptPath());
    const cliPath = join(moduleDir, "vendor-entry.cjs");
    const execPath = join(root, "Contents", "MacOS", "bun");

    // When: command resolution runs under the packaged Bun executable.
    const command = resolveVendorCommand({}, cliPath, {
      env: {},
      execPath,
      argv: ["bun", join(root, "Resources", "main.js")],
      cwd: root,
      moduleDir,
      available: (path) => path === script,
      executable: () => false,
    });

    // Then: bundled Bun interprets the script instead of using the compiled helper.
    expect(command).toEqual({ command: execPath, prefix: [script] });
  });

  it("runs the Playwright MCP JavaScript CLI with Node when the parent is Bun", async () => {
    const source = `
      import { createF2VendorRuntime } from "./src/core/browser-tools/vendor.ts";
      let command = "";
      let socketsDir;
      try {
        await createF2VendorRuntime({
          profileId: "command-test",
          relayCdpUrl: "ws://127.0.0.1:3000/token",
          cliPath: "/tmp/fake-playwright-mcp-cli.js",
          transportFactory: (params) => {
            command = params.command;
            socketsDir = params.env?.PWTEST_SOCKETS_DIR;
            throw new Error("captured vendor command");
          },
        });
      } catch {}
      console.log(JSON.stringify({ command, socketsDir }));
    `;
    const result = await execute(
      process.env.BROWSERLOGIN_BUN_PATH ?? "bun",
      ["-e", source],
      { cwd: process.cwd() },
    );

    expect(JSON.parse(result.stdout.trim())).toEqual({
      command: process.env.BROWSERLOGIN_NODE_PATH ?? "node",
      socketsDir:
        process.env.PWTEST_SOCKETS_DIR ??
        (process.platform === "win32" ? process.env.TEMP : "/tmp"),
    });
  });
});
