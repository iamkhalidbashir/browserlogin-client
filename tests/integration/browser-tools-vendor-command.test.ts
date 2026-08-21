import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);

describe("browser tools vendor command", () => {
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
      command:
      process.env.BROWSERLOGIN_NODE_PATH ?? "node",
      socketsDir:
        process.env.PWTEST_SOCKETS_DIR ??
        (process.platform === "win32" ? process.env.TEMP : "/tmp"),
    });
  });
});
