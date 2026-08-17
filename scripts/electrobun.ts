import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const command = process.argv[2] ?? "dev";
const executable = process.platform === "win32" ? "hutch.exe" : "hutch";
const candidates = [
  process.env.HUTCH_BIN,
  join(homedir(), ".hutch", "bin", executable),
  executable,
].filter((value): value is string => Boolean(value));

let hutch = candidates.at(-1)!;
for (const candidate of candidates.slice(0, -1)) {
  try {
    await access(candidate);
    hutch = candidate;
    break;
  } catch (error) {
    void error;
  }
}

const child = Bun.spawn([hutch, "electrobun", command], {
  cwd: process.cwd(),
  env: process.env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const forward = (signal: NodeJS.Signals) => child.kill(signal);
process.once("SIGTERM", () => forward("SIGTERM"));
process.once("SIGINT", () => forward("SIGINT"));
process.exitCode = await child.exited;
