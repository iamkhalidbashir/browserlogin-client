import { spawn, type ChildProcess } from "node:child_process";
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

describe("Task 13 process identity", () => {
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
    "tree kill reports and reaps both child and grandchild",
    async () => {
      let child: ChildProcess | undefined;
      let grandchildPid: number | undefined;
      let recorded:
        | { pid: number; process_start_time: string; cmdline_hash: string }
        | undefined;
      try {
        const fixtureArgs = [
          "-e",
          "const {spawn}=require('node:child_process'); const child=spawn('sleep',['30']); console.log(child.pid); process.on('SIGTERM',()=>{ if(child.exitCode!==null) process.exit(0); child.once('exit',()=>process.exit(0)); }); setInterval(()=>{},1000)",
        ];
        child = spawn(process.execPath, fixtureArgs, {
          stdio: ["ignore", "pipe", "ignore"],
        });
        const line = await new Promise<string>((resolve, reject) => {
          let output = "";
          const timer = setTimeout(
            () => reject(new Error("grandchild PID was not reported")),
            2_000,
          );
          child?.stdout?.on("data", (chunk: Buffer) => {
            output += chunk.toString();
            const pid = output.trim().split(/\s+/)[0];
            if (/^\d+$/.test(pid)) {
              clearTimeout(timer);
              resolve(pid);
            }
          });
          child?.once("error", reject);
        });
        grandchildPid = Number(line);
        const rootPid = child.pid ?? -1;
        const start = await getProcessStartTime(rootPid);
        const command = await getProcessCommandLine(rootPid);
        expect(start).toBeDefined();
        expect(command).toBeDefined();
        recorded = {
          pid: rootPid,
          process_start_time: start ?? "",
          cmdline_hash: commandLineHash(command ?? []),
        };
        const nodes = await enumerateProcessTree(rootPid);
        expect(nodes.map((node) => node.pid)).toContain(grandchildPid);
        const killed = await killProcessTree(rootPid, {
          recordedIdentity: recorded,
          graceMs: 500,
        });
        expect(killed).toEqual(
          expect.arrayContaining([rootPid, grandchildPid]),
        );
        expect(() => process.kill(rootPid, 0)).toThrow();
        expect(() => process.kill(grandchildPid as number, 0)).toThrow();
      } finally {
        if (child?.pid && recorded) {
          try {
            await killProcessTree(child.pid, {
              recordedIdentity: recorded,
              graceMs: 500,
            });
          } catch {
            void 0;
          }
        }
        if (child?.pid && !recorded) {
          try {
            process.kill(child.pid, "SIGKILL");
          } catch {
            void 0;
          }
        }
        if (grandchildPid) {
          try {
            process.kill(grandchildPid, "SIGKILL");
          } catch {
            void 0;
          }
        }
      }
    },
  );
});
