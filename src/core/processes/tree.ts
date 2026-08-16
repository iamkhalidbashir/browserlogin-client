import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertIdentity, type ProcessIdentity } from "./identity.js";

const execFileAsync = promisify(execFile);
const protectedPid = process.pid;

export type ProcessNode = { pid: number; ppid: number; command?: string };
export type KillTreeOptions = {
  recordedIdentity: ProcessIdentity;
  graceMs?: number;
};

const parsePs = (output: string): ProcessNode[] => {
  const nodes: ProcessNode[] = [];
  for (const line of output.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s*(.*)$/);
    if (match)
      nodes.push({
        pid: Number(match[1]),
        ppid: Number(match[2]),
        command: match[3],
      });
  }
  return nodes;
};

const processTable = async (): Promise<ProcessNode[]> => {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name)" }',
    ]);
    return parsePs(stdout);
  }
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,args="]);
  return parsePs(stdout);
};

export const enumerateProcessTree = async (
  rootPid: number,
): Promise<ProcessNode[]> => {
  const all = await processTable();
  const byParent = new Map<number, ProcessNode[]>();
  for (const node of all)
    byParent.set(node.ppid, [...(byParent.get(node.ppid) ?? []), node]);
  const result: ProcessNode[] = [];
  const visit = (parent: number) => {
    for (const node of byParent.get(parent) ?? []) {
      if (
        node.pid === protectedPid ||
        /(?:^|[\\/\s])atlas(?:\.exe)?(?:\s|$)/i.test(node.command ?? "")
      )
        continue;
      result.push(node);
      visit(node.pid);
    }
  };
  visit(rootPid);
  return result;
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const killProcessTree = async (
  rootPid: number,
  options: KillTreeOptions,
): Promise<number[]> => {
  if (rootPid === protectedPid)
    throw new Error("Refusing to kill the current process");
  await assertIdentity(options.recordedIdentity);
  const descendants = await enumerateProcessTree(rootPid);
  const ordered = [...descendants].reverse().map((node) => node.pid);
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/PID", String(rootPid), "/T", "/F"]);
    } catch {
      void 0;
    }
  } else {
    for (const pid of ordered) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        void 0;
      }
    }
    try {
      process.kill(rootPid, "SIGTERM");
    } catch {
      void 0;
    }
  }
  const deadline = Date.now() + (options.graceMs ?? 1_000);
  while (Date.now() < deadline && (alive(rootPid) || ordered.some(alive)))
    await wait(20);
  if (alive(rootPid) || ordered.some(alive)) {
    if (process.platform !== "win32") {
      for (const pid of [...ordered, rootPid]) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          void 0;
        }
      }
    }
  }
  return [rootPid, ...ordered];
};
