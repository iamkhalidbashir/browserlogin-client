import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { runCli, type CliIO } from "../../src/cli/index.js";
import type { AppServices } from "../../src/bun/rpc.js";
import { SafeZipArchive } from "../../src/core/archive/archive.js";
import {
  LifecycleCoordinator,
  type CoordinatorApi,
  type CoordinatorProfile,
} from "../../src/core/coordinator/index.js";
import { createRecoveryStore } from "../../src/core/coordinator/state.js";
import { readIdentity } from "../../src/core/processes/index.js";
import { evidenceRoot, ensureEvidenceDirectory, writeJson } from "./support.js";

const profile = {
  id: "profile-1",
  name: "Acceptance profile",
  seed: 34,
  platform: "macos",
  geoip: true,
  humanize: true,
  human_preset: "careful",
  bumblebee_profile: "natural",
  headless: true,
  timezone: null,
  locale: "en-US",
  user_agent: null,
  viewport: null,
  args: [],
  proxy: null,
  cloud: { archive_generation: 4, current_session_id: null },
} as CoordinatorProfile["profile"];
const launchSpec = {
  profile_id: profile.id,
  seed: profile.seed,
  platform: "macos" as const,
  geoip: profile.geoip,
  humanize: profile.humanize,
  human_preset: "careful" as const,
  bumblebee_profile: "natural" as const,
  headless: profile.headless,
  timezone: profile.timezone,
  locale: profile.locale,
  user_agent: profile.user_agent,
  viewport: null,
  args: [],
  proxy: null,
};

async function containsMarker(root: string): Promise<boolean> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && (await containsMarker(path))) return true;
    if (entry.isFile() && entry.name === "acceptance-work.txt")
      return (await readFile(path, "utf8")) === "task-34-work\n";
  }
  return false;
}

const root = await mkdtemp(join(tmpdir(), "browserlogin-acceptance-cli-"));
const cliEvidence = join(evidenceRoot, "cli");
await ensureEvidenceDirectory(cliEvidence);
const uploadedArchive = join(cliEvidence, "uploaded-profile.zip");
let binaryPath: string | undefined;
let setupSaved: { baseUrl: string; apiKey: string } | undefined;
let uploads = 0;
let commits = 0;
let starts = 0;
let adoptedGeneration: number | undefined;
let stopCause = "";
const api: CoordinatorApi = {
  async startSession(profileId, key) {
    starts += 1;
    if (profileId !== profile.id || !key.startsWith("start-"))
      throw new Error("invalid acceptance start request");
    return {
      session: {
        id: "session-1",
        profile_id: profileId,
        generation: 4,
        state: "active",
      },
      profile,
      archive: null,
    } as never;
  },
  async downloadArchive() {
    throw new Error("acceptance profile has no remote archive");
  },
  async requestUploadUrl() {
    return {
      upload_url: "http://127.0.0.1/acceptance-upload",
      session_id: "session-1",
      expires_at: "2099-01-01T00:00:00.000Z",
    };
  },
  async directUpload(_grant, path, options) {
    uploads += 1;
    const bytes = await readFile(path);
    if (
      bytes.byteLength !== options.expectedSize ||
      options.expectedSha256.length !== 64
    )
      throw new Error("acceptance upload identity mismatch");
    await copyFile(path, uploadedArchive);
    return "storage-acceptance";
  },
  async stopSession(_sessionId, archive, key) {
    commits += 1;
    if (
      !archive ||
      !key.startsWith("stop-") ||
      archive.storage_id !== "storage-acceptance"
    )
      throw new Error("invalid acceptance stop request");
    return {
      id: "session-1",
      profile_id: profile.id,
      generation: 5,
      state: "stopped",
      status: "stopped",
      archive_generation: 5,
    } as never;
  },
  async forceStopSession() {
    throw new Error("force stop is not part of the acceptance happy path");
  },
  async sessionStatus() {
    return {
      id: "session-1",
      profile_id: profile.id,
      generation: 4,
      state: "active",
      status: "active",
    } as never;
  },
};
const coordinator = new LifecycleCoordinator({
  root,
  api,
  profile: async () => {
    if (!binaryPath) throw new Error("binary download must precede start");
    return {
      profile,
      launchSpec,
      binary: {
        path: binaryPath,
        source: "official",
        trust: "verified",
      } as never,
    };
  },
  runner: async () => {
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 100000)"],
      {
        stdio: "ignore",
      },
    );
    const deadline = Date.now() + 3_000;
    let identity = null;
    while (!identity && Date.now() < deadline) {
      identity = await readIdentity({
        pid: child.pid!,
        process_start_time: "unknown",
        cmdline_hash: "",
      });
      if (!identity)
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }
    if (!identity) throw new Error("acceptance runner identity unavailable");
    return {
      identity,
      stop: async () => {
        child.kill("SIGTERM");
      },
      closed: new Promise<void>((resolvePromise) =>
        child.once("exit", () => resolvePromise()),
      ),
    };
  },
  adoptArchive: async (_profileId, artifact, generation) => {
    adoptedGeneration = generation;
    await copyFile(artifact, join(cliEvidence, `adopted-${generation}.zip`));
  },
});
const services: AppServices = {
  connectionSet: async (raw) => {
    setupSaved = raw as { baseUrl: string; apiKey: string };
    await writeJson(join(cliEvidence, "setup.json"), {
      baseUrl: setupSaved.baseUrl,
      hasApiKey: Boolean(setupSaved.apiKey),
    });
    return { baseUrl: setupSaved.baseUrl, hasApiKey: true };
  },
  binaryStatus: async () =>
    binaryPath
      ? {
          path: binaryPath,
          source: "official",
          trust: "verified",
          pro: false,
        }
      : null,
  binaryDownload: async () => {
    binaryPath = join(root, "verified-browser", "cloakbrowser-test");
    await mkdir(join(root, "verified-browser"), { recursive: true });
    await writeFile(binaryPath, "TEST-ONLY VERIFIED BINARY\n");
    const result = {
      path: binaryPath,
      source: "official",
      trust: "verified",
      pro: false,
    };
    await writeJson(join(cliEvidence, "binary-install.json"), result);
    await writeJson(join(cliEvidence, "binary-progress.json"), [
      { downloaded: 0, total: 26, done: false },
      { downloaded: 26, total: 26, done: true },
    ]);
    return result;
  },
  profilesList: async () => [profile],
  sessionsStart: async () => coordinator.start(profile.id),
  sessionsStop: async () => {
    try {
      return await coordinator.stop(profile.id);
    } catch (error) {
      stopCause = error instanceof Error ? error.message : String(error);
      throw error;
    }
  },
  sessionsLive: async () => [],
};
const stdout: string[] = [];
const stderr: string[] = [];
const prompts = ["https://127.0.0.1:443/api/v1", "bl_test_key_value"];
const io: CliIO = {
  stdout: (value) => stdout.push(value),
  stderr: (value) => stderr.push(value),
  prompt: async () => prompts.shift() ?? "",
};

try {
  for (const argv of [
    ["setup"],
    ["binary", "download"],
    ["profiles", "--json"],
    ["start", profile.id],
  ]) {
    if ((await runCli(argv, { root, services, io })) !== 0)
      throw new Error(`CLI command failed: ${argv.join(" ")}`);
  }
  const state = await createRecoveryStore(root).load(profile.id);
  if (!state || state.status !== "running")
    throw new Error("coordinator did not reach running");
  await writeFile(
    join(state.work_dir, "acceptance-work.txt"),
    "task-34-work\n",
  );
  if ((await runCli(["stop", profile.id], { root, services, io })) !== 0) {
    const failedState = await createRecoveryStore(root).load(profile.id);
    throw new Error(
      `CLI stop failed: ${stderr.join("").trim()} state=${failedState?.status ?? "missing"}`,
      { cause: stopCause ? new Error(stopCause) : undefined },
    );
  }
  const extracted = join(root, "extracted-upload");
  await new SafeZipArchive().extractAtomic(uploadedArchive, extracted);
  if (!(await containsMarker(extracted)))
    throw new Error("uploaded archive omitted work marker");
  if (starts !== 1 || uploads !== 1 || commits !== 1 || adoptedGeneration !== 5)
    throw new Error("acceptance lifecycle counters mismatch");
  if (!setupSaved?.apiKey.startsWith("bl_test_"))
    throw new Error("setup was not persisted");
  await writeJson(join(cliEvidence, "profiles.json"), JSON.parse(stdout[2]!));
  await writeJson(join(cliEvidence, "lifecycle.json"), {
    starts,
    uploads,
    commits,
    generation_before: 4,
    generation_after: adoptedGeneration,
    work_marker_uploaded: true,
    stderr,
  });
} finally {
  await rm(root, { recursive: true, force: true });
}
