import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { promisify } from "node:util";
import type { LockProbe, ProcessStartTime } from "./types.js";

const execFileAsync = promisify(execFile);
let ownStartTime: ProcessStartTime | undefined;
let ownCommandLine: string[] | undefined;

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH")
      return false;
    return true;
  }
};

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
    '$p=Get-CimInstance Win32_Process -Filter "ProcessId=$env:PID_TARGET"; if ($p) { $p.CreationDate.ToUniversalTime().ToString("o") }';
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
  if (pid === process.pid && ownStartTime) return ownStartTime;
  if (!processExists(pid)) return undefined;
  try {
    if (process.platform === "linux") {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      return parseLinuxStartTime(stat);
    }
    const start =
      process.platform === "win32"
        ? await powershellStartTime(pid)
        : await psStartTime(pid);
    if (pid === process.pid) ownStartTime = start;
    return start;
  } catch {
    return undefined;
  }
};

export const getProcessCommandLine = async (
  pid: number,
): Promise<string[] | undefined> => {
  if (pid === process.pid && ownCommandLine) return ownCommandLine;
  try {
    if (process.platform === "linux") {
      const bytes = await readFile(`/proc/${pid}/cmdline`);
      return new TextDecoder().decode(bytes).split("\0").filter(Boolean);
    }
    if (process.platform === "win32") {
      const script =
        '$p=Get-CimInstance Win32_Process -Filter "ProcessId=$env:PID_TARGET"; if ($p) { $p.CommandLine }';
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { env: { ...process.env, PID_TARGET: String(pid) } },
      );
      const command = stdout.trim() ? [stdout.trim()] : undefined;
      if (pid === process.pid) ownCommandLine = command;
      return command;
    }
    const { stdout } = await execFileAsync("ps", [
      "-p",
      String(pid),
      "-o",
      "command=",
    ]);
    const command = stdout.trim() ? [stdout.trim()] : undefined;
    if (pid === process.pid) ownCommandLine = command;
    return command;
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
