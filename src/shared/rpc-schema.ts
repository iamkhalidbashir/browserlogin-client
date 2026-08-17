import { z } from "zod";
import {
  AuditEventSchema,
  MemberSchema,
  NoteVersionSchema,
  UserSchema,
} from "./api-types.js";
import { LocalSettingsSchema } from "./config-types.js";

const empty = z.object({}).strict();
const profileId = z.object({ profileId: z.string().min(1).max(256) }).strict();
const proxyId = z.object({ proxyId: z.string().min(1).max(256) }).strict();
const userId = z.object({ userId: z.string().min(1).max(256) }).strict();
const stringValue = z.string().max(64 * 1024);
const secretInput = z
  .string()
  .min(1)
  .max(16 * 1024);
const statusResult = z.object({ status: z.string() }).passthrough();
const jsonObject = z.record(z.string(), z.unknown());
const safeProxy = z.object({
  id: z.string(),
  name: z.string(),
  protocol: z.enum(["http", "socks5"]),
  host: z.string(),
  port: z.number().int(),
  username: z.string().nullable().optional(),
  change_ip_url: z.string().nullable().optional(),
  last_ip: z.string().nullable().optional(),
  last_ip_changed_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});
const safeProfile = z
  .object({
    id: z.string(),
    name: z.string(),
    seed: z.number().int(),
    proxy: safeProxy.nullable(),
    platform: z.string(),
    geoip: z.boolean(),
    humanize: z.boolean(),
    human_preset: z.enum(["default", "careful"]),
    bumblebee_profile: z.enum([
      "default",
      "precise",
      "fast",
      "natural",
      "messy",
    ]),
    headless: z.boolean(),
    timezone: z.string().nullable(),
    locale: z.string().nullable(),
    user_agent: z.string().nullable(),
    viewport: z.unknown(),
    args: z.array(z.string()),
    notes: z.string().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    cloud: jsonObject,
  })
  .strip();
const binaryInfo = z.object({
  path: z.string(),
  version: z.string().optional(),
  platform: z.string().optional(),
  pro: z.boolean(),
  sha256: z.string().optional(),
  binarySha256: z.string().optional(),
  source: z.enum(["official", "custom"]),
  trust: z.enum(["verified", "unverified-custom", "override"]),
});
const updateState = z.object({
  channel: z.literal("stable"),
  updateAvailable: z.boolean(),
  updateReady: z.boolean(),
  version: z.string().optional(),
  error: z.string().optional(),
  fallbackUrl: z.string().url().optional(),
});

const profileFields = z
  .object({
    name: z.string().min(1).max(256).optional(),
    seed: z.number().int().optional(),
    proxy_id: z.string().nullable().optional(),
    platform: z.enum(["macos", "windows", "linux"]).optional(),
    geoip: z.boolean().optional(),
    humanize: z.boolean().optional(),
    human_preset: z.enum(["default", "careful"]).optional(),
    bumblebee_profile: z
      .enum(["default", "precise", "fast", "natural", "messy"])
      .optional(),
    headless: z.boolean().optional(),
    timezone: z.string().max(256).optional(),
    locale: z.string().max(64).optional(),
    user_agent: z.string().max(4096).optional(),
    viewport: z.unknown().optional(),
    args: z.array(z.string().max(4096)).max(256).optional(),
  })
  .strict();

const proxyFields = z
  .object({
    name: z.string().min(1).max(256),
    protocol: z.enum(["http", "socks5"]),
    host: z.string().min(1).max(256),
    port: z.number().int().min(1).max(65535),
    username: z.string().max(256).nullable().optional(),
    password: secretInput.nullable().optional(),
    change_ip_url: z.string().url().nullable().optional(),
  })
  .strict();

const reply = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }),
    z.object({
      ok: z.literal(false),
      error: z.object({ code: z.string(), message: z.string() }).strict(),
    }),
  ]);

export const AppRPCSchemas = {
  connectionGet: {
    params: empty,
    result: z.object({
      baseUrl: z.string().url(),
      hasApiKey: z.boolean(),
      hasLicense: z.boolean(),
    }),
  },
  connectionSet: {
    params: z
      .object({ baseUrl: z.string().url(), apiKey: secretInput })
      .strict(),
    result: z.object({ baseUrl: z.string().url(), hasApiKey: z.literal(true) }),
  },
  connectionTest: {
    params: empty,
    result: z.object({ connected: z.boolean(), hasApiKey: z.boolean() }),
  },
  connectionClear: {
    params: empty,
    result: z.object({ hasApiKey: z.literal(false) }),
  },
  profilesList: { params: empty, result: z.array(safeProfile) },
  profilesGet: { params: profileId, result: safeProfile },
  profilesCreate: {
    params: profileFields.extend({ name: z.string().min(1).max(256) }),
    result: safeProfile,
  },
  profilesUpdate: {
    params: profileId.merge(
      profileFields.extend({
        expectedConfigVersion: z.number().int().nonnegative(),
      }),
    ),
    result: safeProfile,
  },
  profilesDelete: { params: profileId, result: statusResult },
  profilesRestore: { params: profileId, result: statusResult },
  sessionsStart: { params: profileId, result: jsonObject },
  sessionsStop: { params: profileId, result: jsonObject },
  sessionsForceStop: {
    params: profileId.extend({ confirmation: z.string().min(1).max(512) }),
    result: jsonObject,
  },
  sessionsLive: { params: empty, result: z.array(jsonObject) },
  proxiesList: { params: empty, result: z.array(safeProxy) },
  proxiesCreate: { params: proxyFields, result: safeProxy },
  proxiesUpdate: { params: proxyId.merge(proxyFields), result: safeProxy },
  proxiesDelete: { params: proxyId, result: statusResult },
  proxiesChangeIp: {
    params: proxyId,
    result: z.object({
      id: z.string(),
      ip: z.string(),
      changed_at: z.string(),
    }),
  },
  usersList: { params: empty, result: z.array(UserSchema) },
  usersDisable: { params: userId, result: statusResult },
  membersList: { params: profileId, result: z.array(MemberSchema) },
  membersShare: {
    params: profileId.extend({
      userId: z.string().min(1),
      role: z.enum(["editor", "viewer"]),
    }),
    result: statusResult,
  },
  membersRemove: { params: profileId.merge(userId), result: statusResult },
  notesGet: {
    params: profileId,
    result: z.object({ notes: z.string(), version: z.number().int() }),
  },
  notesAppend: {
    params: profileId.extend({
      notes: stringValue,
      expectedVersion: z.number().int().nonnegative(),
    }),
    result: z.object({ version: z.number().int() }),
  },
  notesReplace: {
    params: profileId.extend({
      notes: stringValue,
      expectedVersion: z.number().int().nonnegative(),
    }),
    result: z.object({ version: z.number().int() }),
  },
  notesHistory: { params: profileId, result: z.array(NoteVersionSchema) },
  auditList: { params: profileId.partial(), result: z.array(AuditEventSchema) },
  binaryStatus: { params: empty, result: binaryInfo.nullable() },
  binaryDownload: {
    params: z
      .object({
        advancedEnabled: z.boolean().default(false),
        pro: z.boolean().optional(),
      })
      .strict(),
    result: binaryInfo,
  },
  binaryProgress: {
    params: empty,
    result: z.object({
      downloaded: z.number(),
      total: z.number().nullable(),
      done: z.boolean(),
    }),
  },
  licenseStatus: {
    params: empty,
    result: z.object({ hasLicense: z.boolean() }),
  },
  licenseSet: {
    params: z.object({ licenseKey: secretInput }).strict(),
    result: z.object({ hasLicense: z.literal(true) }),
  },
  licenseClear: {
    params: empty,
    result: z.object({ hasLicense: z.literal(false) }),
  },
  settingsGet: { params: empty, result: LocalSettingsSchema },
  settingsSet: {
    params: z
      .object({
        downloadSource: z.enum(["official", "custom"]).optional(),
        customDownloadUrl: z.string().url().nullable().optional(),
        browserCacheMaxBytes: z.number().int().nonnegative().optional(),
        advancedEnabled: z.boolean().optional(),
        autoCheckUpdates: z.boolean().optional(),
      })
      .strict(),
    result: LocalSettingsSchema,
  },
  updatesCheck: { params: empty, result: updateState },
  updatesDownload: { params: empty, result: updateState },
  updatesApply: {
    params: z.object({ confirmed: z.literal(true) }).strict(),
    result: updateState,
  },
  cliInstall: {
    params: empty,
    result: z.object({
      installed: z.boolean(),
      path: z.string().optional(),
      message: z.string(),
    }),
  },
  logsTail: {
    params: z
      .object({ lines: z.number().int().min(1).max(500).default(500) })
      .strict(),
    result: z.object({ lines: z.array(z.string()) }),
  },
} as const;

export type AppRPCMethod = keyof typeof AppRPCSchemas;
export type RpcReply<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

type BunRPCSide = {
  requests: {
    [K in AppRPCMethod]: {
      params: z.infer<(typeof AppRPCSchemas)[K]["params"]>;
      response: RpcReply<z.infer<(typeof AppRPCSchemas)[K]["result"]>>;
    };
  };
  messages: Record<string, never>;
};

type WebviewRPCSide = {
  requests: Record<string, never>;
  messages: {
    binaryProgress: {
      downloaded: number;
      total: number | null;
      done: boolean;
    };
    updateStatus: { status: string; message: string };
  };
};

export type AppRPC = {
  bun: BunRPCSide;
  webview: WebviewRPCSide;
};

export const RpcReplySchema = reply(z.unknown());

export function parseRpcReply(value: unknown): RpcReply {
  return RpcReplySchema.parse(value);
}
