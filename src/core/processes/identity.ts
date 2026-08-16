import { createHash } from "node:crypto";
import {
  getProcessCommandLine,
  getProcessStartTime,
} from "../locks/platform.js";

export type ProcessIdentity = {
  pid: number;
  process_start_time: string;
  cmdline_hash: string;
};

export class ProcessIdentityMismatchError extends Error {
  constructor(
    public readonly expected: ProcessIdentity,
    public readonly actual?: ProcessIdentity,
  ) {
    super(`Process identity mismatch for pid ${expected.pid}`);
    this.name = "ProcessIdentityMismatchError";
  }
}

export const normalizeCommandLine = (argv: readonly string[]): string =>
  argv
    .map((part) => part.trim().replaceAll(/\\+/g, "/").replaceAll(/\s+/g, " "))
    .filter(Boolean)
    .join(" ");

export const commandLineHash = (argv: readonly string[]): string =>
  createHash("sha256").update(normalizeCommandLine(argv)).digest("hex");

export const captureIdentity = async (
  argv: readonly string[] = process.argv,
): Promise<ProcessIdentity> => ({
  pid: process.pid,
  process_start_time: (await getProcessStartTime(process.pid)) ?? "unknown",
  cmdline_hash: commandLineHash(
    (await getProcessCommandLine(process.pid)) ?? argv,
  ),
});

export const readIdentity = async (
  identity: ProcessIdentity,
): Promise<ProcessIdentity | undefined> => {
  const start = await getProcessStartTime(identity.pid);
  if (start === undefined) return undefined;
  const argv = await getProcessCommandLine(identity.pid);
  if (!argv) return undefined;
  return {
    pid: identity.pid,
    process_start_time: start,
    cmdline_hash: commandLineHash(argv),
  };
};

export const assertIdentity = async (
  expected: ProcessIdentity,
): Promise<ProcessIdentity> => {
  const actual = await readIdentity(expected);
  if (
    !actual ||
    actual.process_start_time !== expected.process_start_time ||
    actual.cmdline_hash !== expected.cmdline_hash
  )
    throw new ProcessIdentityMismatchError(expected, actual);
  return actual;
};
