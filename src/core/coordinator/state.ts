import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { atomicWriteJson, readJson } from "../config/store.js";
import {
  ensureStatePaths,
  posixPathSecurity,
  statePaths,
  type PathSecurity,
} from "../config/paths.js";
import { connectionTransitionLock, profileLock } from "../locks/names.js";
import { withLock } from "../locks/locks.js";
import { StateError } from "../../shared/errors.js";

const HEX64 = /^[0-9a-f]{64}$/;
const RUN_ID = /^[0-9a-f]{32}$/;
const SAFE_ID = /^[^\0\r\n]{1,256}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export const RECOVERY_STATUSES = [
  "start-intent",
  "license",
  "remote-active",
  "archive_materialized",
  "spawn-intent",
  "running",
  "archive-ready",
  "upload-pending",
  "done",
  "force-stop",
  "upload-ambiguous",
] as const;
export type RecoveryStatus = (typeof RECOVERY_STATUSES)[number];

const archive = z.object({
  generation: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(HEX64),
  format: z.literal("zip"),
});
const base = z.object({
  version: z.literal(1),
  profile_id: z.string().regex(SAFE_ID),
  run_id: z.string().regex(RUN_ID),
  start_key: z.string().regex(SAFE_ID),
  stop_key: z.string().regex(SAFE_ID).nullable(),
  remote_session_id: z.string().regex(SAFE_ID).nullable(),
  archive: archive.nullable(),
  archive_artifact: z.string().regex(SAFE_ID).nullable(),
  work_dir: z.string().regex(SAFE_ID),
  cache_dir: z.string().regex(SAFE_ID),
  launch_file: z.string().regex(SAFE_ID).nullable(),
  runner_pid: z.number().int().positive().nullable(),
  runner_start_time: z.string().regex(SAFE_ID).nullable(),
  runner_cmdline_hash: z.string().regex(HEX64).nullable(),
  license_acquired: z.boolean(),
  archive_materialized: z.boolean(),
  browser_launched: z.boolean(),
  relay_cdp_url: z.string().regex(SAFE_ID).nullable().optional(),
  uploaded_storage_id: z.string().regex(SAFE_ID).nullable(),
  stop_payload: z.record(z.string(), z.unknown()).nullable(),
  retry_count: z.number().int().nonnegative(),
  retry_after: z.string().regex(ISO_DATE).nullable(),
  updated_at: z.string().regex(ISO_DATE),
});
const stateSchema = z.discriminatedUnion("status", [
  base.extend({ status: z.literal("start-intent") }),
  base.extend({ status: z.literal("license") }),
  base.extend({ status: z.literal("remote-active") }),
  base.extend({ status: z.literal("archive_materialized") }),
  base.extend({ status: z.literal("spawn-intent") }),
  base.extend({ status: z.literal("running") }),
  base.extend({ status: z.literal("archive-ready") }),
  base.extend({ status: z.literal("upload-pending") }),
  base.extend({ status: z.literal("done") }),
  base.extend({ status: z.literal("force-stop") }),
  base.extend({ status: z.literal("upload-ambiguous") }),
]);

export type RecoveryState = z.infer<typeof stateSchema>;
export { stateSchema as RecoveryStateSchema };

const forbiddenKeys =
  /api[_-]?key|license[_-]?key|authorization|password|secret|token|credential|upload[_-]?url/i;
function assertSecretFree(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertSecretFree);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (
      forbiddenKeys.test(key) ||
      (typeof item === "string" && forbiddenKeys.test(item))
    )
      throw new StateError("recovery state contains forbidden secret material");
    assertSecretFree(item);
  }
}

export function validateRecoveryState(value: unknown): RecoveryState {
  const result = stateSchema.safeParse(value);
  if (!result.success) throw new StateError("recovery state schema is invalid");
  const state = result.data;
  assertSecretFree(state);
  if (state.license_acquired && state.status === "start-intent")
    throw new StateError("start-intent cannot have an acquired license");
  if (
    state.status === "running" &&
    (!state.remote_session_id || !state.browser_launched)
  )
    throw new StateError("running state is incomplete");
  if (
    (state.status === "upload-pending" ||
      state.status === "upload-ambiguous") &&
    !state.archive_artifact
  )
    throw new StateError("upload recovery state is incomplete");
  if (state.status === "done" && (!state.stop_key || !state.stop_payload))
    throw new StateError("done state is incomplete");
  if (state.status === "force-stop" && state.stop_payload?.["force"] !== true)
    throw new StateError("force-stop state is incomplete");
  if (
    [
      "remote-active",
      "archive_materialized",
      "spawn-intent",
      "running",
      "archive-ready",
      "upload-pending",
      "done",
      "force-stop",
      "upload-ambiguous",
    ].includes(state.status) &&
    !state.remote_session_id
  )
    throw new StateError(
      "remote lifecycle state is missing its session identity",
    );
  if (
    state.runner_pid === null &&
    (state.runner_start_time !== null || state.runner_cmdline_hash !== null)
  )
    throw new StateError("runner identity fields must be persisted together");
  if (
    state.runner_pid !== null &&
    (state.runner_start_time === null || state.runner_cmdline_hash === null)
  )
    throw new StateError("runner identity is incomplete");
  return state;
}

export function assertStatePath(root: string, value: string): string {
  const resolvedRoot = resolve(root);
  const resolved = resolve(value);
  const suffix = relative(resolvedRoot, resolved);
  if (isAbsolute(suffix) || suffix === ".." || suffix.startsWith("../"))
    throw new StateError("recovery path escapes the coordinator root");
  return resolved;
}

export function profileStatePath(root: string, profileId: string): string {
  return join(
    statePaths(root).state,
    `${createHash("sha256").update(profileId).digest("hex")}.json`,
  );
}

export function immutableIdempotencyKey(
  operation: "start" | "stop" | "force-stop",
  runId: string,
  payload: unknown,
): string {
  return `${operation}-${createHash("sha256")
    .update(JSON.stringify({ operation, run_id: runId, payload }))
    .digest("hex")}`;
}

export function createRecoveryStore(
  root: string,
  security: PathSecurity = posixPathSecurity(),
) {
  const paths = statePaths(root);
  const pathFor = (profileId: string) => profileStatePath(root, profileId);
  return {
    paths,
    pathFor,
    async ensure(): Promise<void> {
      await ensureStatePaths(paths, security);
    },
    async load(profileId: string): Promise<RecoveryState | null> {
      const value = await readJson<unknown>(pathFor(profileId), security);
      if (value === null) return null;
      const state = validateRecoveryState(value);
      if (state.profile_id !== profileId)
        throw new StateError("recovery profile identity mismatch");
      return state;
    },
    async save(state: RecoveryState): Promise<void> {
      const validated = validateRecoveryState(state);
      await mkdir(paths.state, { recursive: true, mode: 0o700 });
      await atomicWriteJson(pathFor(validated.profile_id), validated, security);
    },
    async remove(profileId: string): Promise<void> {
      await rm(pathFor(profileId), { force: true });
    },
    async withTransition<T>(
      profileId: string,
      work: () => Promise<T>,
    ): Promise<T> {
      await this.ensure();
      return withLock(connectionTransitionLock(paths.locks), () =>
        withLock(profileLock(paths.locks, profileId), work),
      );
    },
  };
}
