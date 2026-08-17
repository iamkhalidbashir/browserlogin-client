import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { promisify } from "node:util";
import type { LockProbe, ProcessStartTime } from "./types.js";

const execFileAsync = promisify(execFile);

const parseLinuxStartTime = (stat: string): ProcessStartTime | undefined => {
  const close = stat.lastIndexOf(")");
  if (close < 0) return undefined;
  const fields = stat
    .slice(close + 2)
    .trim()
    .split(/\s+/);
  return fields[19];
};

const psStartTime = async (
  pid: number,
): Promise<ProcessStartTime | undefined> => {
  const { stdout } = await execFileAsync("ps", [
    "-p",
    String(pid),
    "-o",
    "lstart=",
  ]);
  const value = stdout.trim();
  return value || undefined;
};

const powershellStartTime = async (
  pid: number,
): Promise<ProcessStartTime | undefined> => {
  const script =
    "$p=Get-CimInstance Win32_Process -Filter 'ProcessId=$env:PID_TARGET'; if ($p) { $p.CreationDate.ToUniversalTime().ToString('o') }";
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      env: { ...process.env, PID_TARGET: String(pid) },
    },
  );
  const value = stdout.trim();
  return value || undefined;
};

export const getProcessStartTime = async (
  pid: number,
): Promise<ProcessStartTime | undefined> => {
  try {
    if (process.platform === "linux") {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      return parseLinuxStartTime(stat);
    }
    if (process.platform === "win32") return await powershellStartTime(pid);
    return await psStartTime(pid);
  } catch {
    return undefined;
  }
};

export const getProcessCommandLine = async (
  pid: number,
): Promise<string[] | undefined> => {
  try {
    if (process.platform === "linux") {
      const bytes = await readFile(`/proc/${pid}/cmdline`);
      return new TextDecoder().decode(bytes).split("\0").filter(Boolean);
    }
    if (process.platform === "win32") {
      const script =
        "$p=Get-CimInstance Win32_Process -Filter 'ProcessId=$env:PID_TARGET'; if ($p) { $p.CommandLine }";
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { env: { ...process.env, PID_TARGET: String(pid) } },
      );
      return stdout.trim() ? [stdout.trim()] : undefined;
    }
    const { stdout } = await execFileAsync("ps", [
      "-p",
      String(pid),
      "-o",
      "command=",
    ]);
    return stdout.trim() ? [stdout.trim()] : undefined;
  } catch {
    return undefined;
  }
};

export const probeProcess = async (
  pid: number,
  expectedStartTime?: ProcessStartTime,
): Promise<LockProbe> => {
  const start = await getProcessStartTime(pid);
  return {
    pid,
    process_start_time: start ?? expectedStartTime ?? "",
    alive: start !== undefined,
  };
};

export const currentOwner = async (now = (): Date => new Date()) => ({
  pid: process.pid,
  process_start_time: (await getProcessStartTime(process.pid)) ?? "unknown",
  hostname: hostname(),
  created_at: now().toISOString(),
});

export const isMatchingLiveProcess = async (
  pid: number,
  startTime: ProcessStartTime,
): Promise<boolean> => {
  const probe = await probeProcess(pid, startTime);
  return (
    probe.alive &&
    (startTime === "unknown" || probe.process_start_time === startTime)
  );
};

export const parseLinuxProcessStartTime = parseLinuxStartTime;
