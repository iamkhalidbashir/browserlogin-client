import type { GuideTool } from "./types.js";

export const REMOTE_MCP_TOOLS: readonly GuideTool[] = [
  {
    name: "profiles_list",
    description: "List profiles the API key can access.",
    arguments: "None.",
  },
  {
    name: "profile_get",
    description: "Read one profile.",
    arguments: "profile_id",
  },
  {
    name: "profile_create",
    description: "Create a profile and optionally bind a workspace proxy.",
    arguments: "idempotency_key, name",
  },
  {
    name: "profile_update",
    description: "Update profile configuration with optimistic concurrency.",
    arguments: "profile_id, expected_config_version, name",
  },
  {
    name: "profile_delete",
    description: "Soft-delete a profile.",
    arguments: "profile_id",
  },
  {
    name: "profile_restore",
    description: "Restore a deleted profile.",
    arguments: "profile_id",
  },
  {
    name: "notes_get",
    description: "Read current profile notes.",
    arguments: "profile_id",
  },
  {
    name: "notes_append",
    description: "Append profile notes with optimistic concurrency.",
    arguments: "profile_id, notes, expected_version",
  },
  {
    name: "notes_update",
    description: "Replace profile notes with optimistic concurrency.",
    arguments: "profile_id, notes, expected_version",
  },
  {
    name: "proxies_list",
    description: "List workspace proxies with credentials redacted.",
    arguments: "None.",
  },
  {
    name: "proxy_change_ip",
    description: "Request server-side proxy IP rotation.",
    arguments: "proxy_id",
  },
  {
    name: "members_list",
    description: "List members of a profile.",
    arguments: "profile_id",
  },
  {
    name: "member_share",
    description: "Share a profile with an editor or viewer.",
    arguments: "profile_id, user_id, role",
  },
  {
    name: "member_remove",
    description: "Remove a profile member.",
    arguments: "profile_id, user_id",
  },
  {
    name: "users_list",
    description: "List workspace users.",
    arguments: "None.",
  },
  {
    name: "user_disable",
    description: "Disable a workspace user.",
    arguments: "user_id",
  },
  {
    name: "audit_list",
    description: "List workspace audit events, optionally for a profile.",
    arguments: "Optional profile_id",
  },
] as const;
