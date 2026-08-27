import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { withLock } from "../../src/core/locks/locks.js";
import { parseLinuxProcessStartTime } from "../../src/core/locks/platform.js";
import { captureIdentity } from "../../src/core/processes/identity.js";
import {
  LockTimeoutError,
  type LockOwner,
} from "../../src/core/locks/types.js";

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
    const owner: LockOwner = {
      pid: 1,
      process_start_time: "test-process-start-time",
      hostname: "test-host",
      created_at: "2026-01-01T00:00:00.000Z",
    };
    await Promise.all(
      Array.from({ length: 50 }, async () =>
        withLock(
          lockPath,
          async () => {
            active += 1;
            maximum = Math.max(maximum, active);
            const value = Number(await readFile(counterPath, "utf8"));
            await new Promise((resolve) => setTimeout(resolve, 2));
            await writeFile(counterPath, String(value + 1));
            active -= 1;
          },
          { owner },
        ),
      ),
    );
    expect(await readFile(counterPath, "utf8")).toBe("50");
    expect(maximum).toBe(1);
    await expect(readFile(lockPath, "utf8")).rejects.toThrow();
    await rm(directory, { recursive: true, force: true });
  }, 15_000);

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

  it("reclaims stale dead-PID owners", async () => {
    const directory = await temp();
    const dead = join(directory, "dead.lock");
    const owner = {
      pid: 999999999,
      process_start_time: "old",
      hostname: "test",
      created_at: new Date().toISOString(),
    };
    await mkdir(directory, { recursive: true });
    await writeFile(dead, JSON.stringify(owner), { mode: 0o600 });
    await withLock(dead, async () => undefined, { timeoutMs: 500, pollMs: 1 });
    await rm(directory, { recursive: true, force: true });
  });

  it("reclaims old empty legacy locks but keeps fresh malformed locks", async () => {
    const directory = await temp();
    const oldLock = join(directory, "old-empty.lock");
    const freshLock = join(directory, "fresh-empty.lock");
    await writeFile(oldLock, "", { mode: 0o600 });
    await writeFile(freshLock, "", { mode: 0o600 });
    const old = new Date(Date.now() - 60_000);
    await utimes(oldLock, old, old);

    await withLock(oldLock, async () => undefined, {
      timeoutMs: 500,
      pollMs: 1,
    });
    await expect(
      withLock(freshLock, async () => undefined, {
        timeoutMs: 20,
        pollMs: 1,
      }),
    ).rejects.toBeInstanceOf(LockTimeoutError);

    await rm(directory, { recursive: true, force: true });
  });

  it("reclaims stale live-PID owners with a wrong process start time", async () => {
    const directory = await temp();
    const lockPath = join(directory, "reused.lock");
    const current = await captureIdentity();
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: current.pid,
        process_start_time: `impossible-${current.process_start_time}`,
        hostname: "test",
        created_at: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    await withLock(lockPath, async () => undefined, {
      timeoutMs: 500,
      pollMs: 1,
    });
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps a live owner with a matching process start time blocked", async () => {
    const directory = await temp();
    const lockPath = join(directory, "live.lock");
    const current = await captureIdentity();
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: current.pid,
        process_start_time: current.process_start_time,
        hostname: "test",
        created_at: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    await expect(
      withLock(lockPath, async () => undefined, { timeoutMs: 20, pollMs: 1 }),
    ).rejects.toBeInstanceOf(LockTimeoutError);
    await rm(directory, { recursive: true, force: true });
  });

  it("does not reclaim a replaced live owner file", async () => {
    const directory = await temp();
    const lockPath = join(directory, "replaced.lock");
    const staleOwner = {
      pid: 999999999,
      process_start_time: "old",
      hostname: "test",
      created_at: new Date().toISOString(),
    };
    const current = await captureIdentity();
    const liveOwner = {
      pid: current.pid,
      process_start_time: current.process_start_time,
      hostname: "test",
      created_at: new Date().toISOString(),
    };
    await writeFile(lockPath, JSON.stringify(staleOwner), { mode: 0o600 });
    await writeFile(lockPath, JSON.stringify(liveOwner), { mode: 0o600 });
    await expect(
      withLock(lockPath, async () => undefined, { timeoutMs: 20, pollMs: 1 }),
    ).rejects.toBeInstanceOf(LockTimeoutError);
    await expect(readFile(lockPath, "utf8")).resolves.toBe(
      JSON.stringify(liveOwner),
    );
    await rm(directory, { recursive: true, force: true });
  });
});
