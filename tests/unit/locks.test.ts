import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { withLock } from "../../src/core/locks/locks.js";
import { parseLinuxProcessStartTime } from "../../src/core/locks/platform.js";
import { captureIdentity } from "../../src/core/processes/identity.js";

const temp = async () => mkdtemp(join(tmpdir(), "browserlogin-task13-"));

describe("Task 13 locks", () => {
  it("parses Linux stat field 22 after the executable name", () => {
    const stat = `1 (fixture (safe)) S ${Array.from({ length: 18 }, () => "0").join(" ")} 424242 0`;
    expect(parseLinuxProcessStartTime(stat)).toBe("424242");
  });

  it("serializes 50 same-process holders and cleans the lock", async () => {
    const directory = await temp();
    const lockPath = join(directory, "counter.lock");
    const counterPath = join(directory, "counter");
    await writeFile(counterPath, "0");
    let active = 0;
    let maximum = 0;
    await Promise.all(
      Array.from({ length: 50 }, async () =>
        withLock(lockPath, async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          const value = Number(await readFile(counterPath, "utf8"));
          await new Promise((resolve) => setTimeout(resolve, 2));
          await writeFile(counterPath, String(value + 1));
          active -= 1;
        }),
      ),
    );
    expect(await readFile(counterPath, "utf8")).toBe("50");
    expect(maximum).toBe(1);
    await expect(readFile(lockPath, "utf8")).rejects.toThrow();
    await rm(directory, { recursive: true, force: true });
  });

  it.runIf(process.platform !== "win32")(
    "serializes real cross-process contenders",
    async () => {
      const directory = await temp();
      const lockPath = join(directory, "cross.lock");
      const counterPath = join(directory, "cross-counter");
      await writeFile(counterPath, "0");
      const moduleUrl = new URL(
        "../../src/core/locks/locks.ts",
        import.meta.url,
      ).href;
      const script = `import { readFile, writeFile } from "node:fs/promises"; import { withLock } from "${moduleUrl}"; const [lock,counter] = process.argv.slice(1); for (let i=0;i<10;i++) await withLock(lock, async () => { const n=Number(await readFile(counter,"utf8")); await new Promise(r=>setTimeout(r,2)); await writeFile(counter,String(n+1)); });`;
      const children = Array.from({ length: 5 }, () =>
        spawn("bun", ["-e", script, lockPath, counterPath], { stdio: "pipe" }),
      );
      const results = await Promise.all(
        children.map(
          (child) =>
            new Promise<{ code: number; stderr: string }>((resolve) => {
              let stderr = "";
              child.stderr?.on("data", (chunk: Buffer) => {
                stderr += chunk.toString();
              });
              child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
            }),
        ),
      );
      expect(
        results.map((result) => result.stderr),
        results.map((result) => result.stderr).join("\n"),
      ).toEqual(["", "", "", "", ""]);
      expect(results.map((result) => result.code)).toEqual([0, 0, 0, 0, 0]);
      expect(await readFile(counterPath, "utf8")).toBe("50");
      await rm(directory, { recursive: true, force: true });
    },
  );

  it("reclaims dead and PID-reused owners but blocks matching live owners", async () => {
    const directory = await temp();
    const dead = join(directory, "dead.lock");
    const live = join(directory, "live.lock");
    const owner = {
      pid: 999999999,
      process_start_time: "old",
      hostname: "test",
      created_at: new Date().toISOString(),
    };
    await mkdir(directory, { recursive: true });
    await writeFile(dead, JSON.stringify(owner), { mode: 0o600 });
    await withLock(dead, async () => undefined, { timeoutMs: 500, pollMs: 1 });
    const current = await captureIdentity();
    await writeFile(
      live,
      JSON.stringify({
        ...owner,
        pid: current.pid,
        process_start_time: current.process_start_time,
      }),
      { mode: 0o600 },
    );
    await expect(
      withLock(live, async () => undefined, { timeoutMs: 20, pollMs: 1 }),
    ).rejects.toThrow();
    await rm(directory, { recursive: true, force: true });
  });
});
