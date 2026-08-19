import { join } from "node:path";
import { z } from "zod";

const SAFE_TEXT = /^[^\0\r\n]{1,256}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const RUN_ID = /^[0-9a-f]{32}$/;

const legacyUploadPendingSchema = z.object({
  profile_id: z.string().regex(SAFE_TEXT),
  run_id: z.string().regex(RUN_ID),
  start_key: z.string().regex(SAFE_TEXT),
  stop_key: z.string().regex(SAFE_TEXT).nullable(),
  remote_session_id: z.string().regex(SAFE_TEXT),
  archive: z.object({
    generation: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(HEX64),
    format: z.literal("zip"),
  }),
  pending_archive_artifact: z.string().regex(SAFE_TEXT),
  launch_file: z.string().regex(SAFE_TEXT).nullable(),
  runner_pid: z.null(),
  license_acquired: z.boolean(),
  archive_materialized: z.boolean(),
  browser_launched: z.boolean(),
  uploaded_storage_id: z.string().regex(SAFE_TEXT).nullable(),
  stop_payload: z.record(z.string(), z.unknown()).nullable(),
  status: z.literal("upload-pending"),
});

export function migrateLegacyRecoveryState(
  root: string,
  value: unknown,
): unknown {
  const parsed = legacyUploadPendingSchema.safeParse(value);
  if (!parsed.success) return value;
  const legacy = parsed.data;
  return {
    version: 1,
    profile_id: legacy.profile_id,
    run_id: legacy.run_id,
    start_key: legacy.start_key,
    stop_key: legacy.stop_key,
    remote_session_id: legacy.remote_session_id,
    archive: legacy.archive,
    archive_artifact: legacy.pending_archive_artifact,
    work_dir: join(root, "work", legacy.run_id),
    cache_dir: join(root, "browser-cache", legacy.run_id),
    launch_file: legacy.launch_file,
    runner_pid: null,
    runner_start_time: null,
    runner_cmdline_hash: null,
    license_acquired: legacy.license_acquired,
    archive_materialized: legacy.archive_materialized,
    browser_launched: legacy.browser_launched,
    relay_cdp_url: null,
    uploaded_storage_id: legacy.uploaded_storage_id,
    stop_payload: legacy.stop_payload,
    retry_count: 0,
    retry_after: null,
    updated_at: new Date().toISOString(),
    status: legacy.status,
  };
}
