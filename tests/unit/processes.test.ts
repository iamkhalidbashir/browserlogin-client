import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  getProcessCommandLine,
  getProcessStartTime,
} from "../../src/core/locks/platform.js";
import {
  assertIdentity,
  captureIdentity,
  commandLineHash,
  ProcessIdentityMismatchError,
} from "../../src/core/processes/identity.js";
import {
  enumerateProcessTree,
  killProcessTree,
} from "../../src/core/processes/tree.js";

describe("Task 13 process identity and tree kill", () => {
  it("hashes normalized argv and rejects a changed identity", async () => {
    expect(commandLineHash(["/tmp/bin", "  --profile", "x"])).toBe(
      commandLineHash(["/tmp/bin", "--profile", "x"]),
    );
    const identity = await captureIdentity();
    await expect(
      assertIdentity({ ...identity, cmdline_hash: "0".repeat(64) }),
    ).rejects.toBeInstanceOf(ProcessIdentityMismatchError);
  });

  it.runIf(process.platform !== "win32")(
    "enumerates and kills a real grandchild tree",
    async () => {
      const fixtureArgs = [
        "-e",
        "const {spawn}=require('node:child_process'); spawn('sleep',['30'],{stdio:'ignore'}); setInterval(()=>{},1000)",
      ];
      const child = spawn(process.execPath, fixtureArgs, { stdio: "ignore" });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const start = await getProcessStartTime(child.pid ?? -1);
      expect(start).toBeDefined();
      const command = await getProcessCommandLine(child.pid ?? -1);
      expect(command).toBeDefined();
      const recorded = {
        pid: child.pid ?? -1,
        process_start_time: start ?? "",
        cmdline_hash: commandLineHash(command ?? []),
      };
      const nodes = await enumerateProcessTree(child.pid ?? -1);
      expect(nodes.length).toBeGreaterThanOrEqual(1);
      await killProcessTree(child.pid ?? -1, {
        recordedIdentity: recorded,
        graceMs: 500,
      });
      expect(() => process.kill(child.pid ?? -1, 0)).toThrow();
    },
  );
});
