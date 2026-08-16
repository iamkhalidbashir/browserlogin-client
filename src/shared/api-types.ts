import { z } from "zod";

const nullableString = z.string().nullable();
const timestamp = nullableString;

export const UserSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    status: z.string(),
    owner: z.boolean().optional(),
    created_at: timestamp.optional(),
    updated_at: timestamp.optional(),
  })
  .passthrough();

export const ProxySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    protocol: z.string(),
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    username: nullableString.optional(),
    password: nullableString.optional(),
    change_ip_url: nullableString.optional(),
    last_ip: nullableString.optional(),
    last_ip_changed_at: timestamp.optional(),
    created_at: timestamp.optional(),
    updated_at: timestamp.optional(),
  })
  .passthrough();

export const ProfileCloudSchema = z
  .object({
    role: z.string().optional(),
    config_version: z.number().int().optional(),
    notes_version: z.number().int().optional(),
    archive_generation: z.number().int().optional(),
    session_generation: z.number().int().optional(),
    current_session_id: nullableString.optional(),
    deleted_at: timestamp.optional(),
  })
  .passthrough();

export const ProfileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    seed: z.number().int(),
    proxy: ProxySchema.nullable(),
    platform: z.string(),
    geoip: z.boolean(),
    humanize: z.boolean(),
    human_preset: z.string(),
    bumblebee_profile: z.string(),
    headless: z.boolean(),
    timezone: nullableString,
    locale: nullableString,
    user_agent: nullableString,
    viewport: z.unknown(),
    args: z.array(z.string()),
    notes: z.string().optional(),
    created_at: timestamp.optional(),
    updated_at: timestamp.optional(),
    cloud: ProfileCloudSchema,
  })
  .passthrough();

export const SessionSchema = z
  .object({
    id: z.string(),
    profile_id: z.string(),
    generation: z.number().int(),
    state: z.string(),
    started_at: timestamp.optional(),
    heartbeat_at: timestamp.optional(),
    expires_at: timestamp.optional(),
    force_stopped_at: timestamp.optional(),
    stopped_at: timestamp.optional(),
    status: z.string().optional(),
    archive_generation: z.number().int().optional(),
  })
  .passthrough();

export const ArchiveIdentitySchema = z
  .object({
    profile_id: z.string(),
    generation: z.number().int(),
    size: z.number().int().nonnegative(),
    sha256: z.string(),
    format: z.string(),
    download_url: z.string().optional(),
    created_at: z.string().optional(),
  })
  .passthrough();

export const StartResponseSchema = z
  .object({
    session: SessionSchema,
    profile: ProfileSchema,
    archive: ArchiveIdentitySchema.nullable(),
  })
  .passthrough();

export const NoteVersionSchema = z
  .object({
    id: z.string(),
    version: z.number().int(),
    notes: z.string(),
    created_by: z.string(),
    created_at: z.string(),
  })
  .passthrough();

export const MemberSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    status: z.string(),
    role: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough();

export const ApiKeyMetadataSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    prefix: z.string(),
    status: z.string(),
    expires_at: timestamp,
    last_used_at: timestamp,
    revoked_at: timestamp,
    created_at: z.string(),
  })
  .passthrough();

export const AuditEventSchema = z
  .object({
    action: z.string(),
    entity_type: z.string(),
    entity_id: z.string(),
    actor_user_id: z.string(),
    created_at: z.string(),
  })
  .passthrough();

export type User = z.infer<typeof UserSchema>;
export type Proxy = z.infer<typeof ProxySchema>;
export type ProfileCloud = z.infer<typeof ProfileCloudSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type ArchiveIdentity = z.infer<typeof ArchiveIdentitySchema>;
export type StartResponse = z.infer<typeof StartResponseSchema>;
export type NoteVersion = z.infer<typeof NoteVersionSchema>;
export type Member = z.infer<typeof MemberSchema>;
export type ApiKeyMetadata = z.infer<typeof ApiKeyMetadataSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
