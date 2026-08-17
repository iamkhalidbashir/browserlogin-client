import {
  AppRPCSchemas,
  type AppRPCMethod,
  type RpcReply,
} from "../shared/rpc-schema.js";
import type { Bridge, BridgeParams, BridgeResult } from "./rpc-client.js";

const profile = {
  id: "profile-1",
  name: "Research profile",
  seed: 42,
  proxy: null,
  platform: "macos",
  geoip: true,
  humanize: true,
  human_preset: "careful" as const,
  bumblebee_profile: "natural" as const,
  headless: false,
  timezone: "America/Los_Angeles",
  locale: "en-US",
  user_agent: null,
  viewport: { width: 1440, height: 900 },
  args: [],
  cloud: { archive_generation: 4, current_session_id: null },
};

export const mockParams: Record<AppRPCMethod, unknown> = {
  connectionGet: {},
  connectionSet: {
    baseUrl: "https://example.test/api/v1",
    apiKey: "bl_test_key_value",
  },
  connectionTest: {},
  connectionClear: {},
  profilesList: {},
  profilesGet: { profileId: "profile-1" },
  profilesCreate: { name: "New profile" },
  profilesUpdate: { profileId: "profile-1", expectedConfigVersion: 1 },
  profilesDelete: { profileId: "profile-1" },
  profilesRestore: { profileId: "profile-1" },
  sessionsStart: { profileId: "profile-1" },
  sessionsStop: { profileId: "profile-1" },
  sessionsForceStop: {
    profileId: "profile-1",
    confirmation: "FORCE CLOSE profile-1",
  },
  sessionsLive: {},
  proxiesList: {},
  proxiesCreate: {
    name: "Local",
    protocol: "http",
    host: "127.0.0.1",
    port: 8080,
  },
  proxiesUpdate: {
    proxyId: "proxy-1",
    name: "Local",
    protocol: "http",
    host: "127.0.0.1",
    port: 8080,
  },
  proxiesDelete: { proxyId: "proxy-1" },
  proxiesChangeIp: { proxyId: "proxy-1" },
  usersList: {},
  usersDisable: { userId: "user-1" },
  membersList: { profileId: "profile-1" },
  membersShare: { profileId: "profile-1", userId: "user-1", role: "viewer" },
  membersRemove: { profileId: "profile-1", userId: "user-1" },
  notesGet: { profileId: "profile-1" },
  notesAppend: { profileId: "profile-1", notes: "Note", expectedVersion: 1 },
  notesReplace: { profileId: "profile-1", notes: "Note", expectedVersion: 1 },
  notesHistory: { profileId: "profile-1" },
  auditList: {},
  binaryStatus: {},
  binaryDownload: { advancedEnabled: false },
  binaryProgress: {},
  licenseStatus: {},
  licenseSet: { licenseKey: "license-value" },
  licenseClear: {},
  settingsGet: {},
  settingsSet: { advancedEnabled: false },
  updatesCheck: {},
  updatesDownload: {},
  updatesApply: { confirmed: true },
  cliInstall: {},
  logsTail: { lines: 500 },
};

const values: Record<AppRPCMethod, unknown> = {
  connectionGet: {
    baseUrl: "https://example.test/api/v1",
    hasApiKey: true,
    hasLicense: false,
  },
  connectionSet: { baseUrl: "https://example.test/api/v1", hasApiKey: true },
  connectionTest: { connected: true, hasApiKey: true },
  connectionClear: { hasApiKey: false },
  profilesList: [profile],
  profilesGet: profile,
  profilesCreate: profile,
  profilesUpdate: profile,
  profilesDelete: { status: "deleted" },
  profilesRestore: { status: "restored" },
  sessionsStart: { profile_id: "profile-1", status: "running" },
  sessionsStop: { profile_id: "profile-1", status: "stopped" },
  sessionsForceStop: { profile_id: "profile-1", status: "force-stopped" },
  sessionsLive: [],
  proxiesList: [
    {
      id: "proxy-1",
      name: "Local",
      protocol: "http",
      host: "127.0.0.1",
      port: 8080,
      username: "workspace-user",
      last_ip: "203.0.113.9",
      last_ip_changed_at: "2026-08-17T00:00:00Z",
    },
  ],
  proxiesCreate: {
    id: "proxy-1",
    name: "Local",
    protocol: "http",
    host: "127.0.0.1",
    port: 8080,
  },
  proxiesUpdate: {
    id: "proxy-1",
    name: "Local",
    protocol: "http",
    host: "127.0.0.1",
    port: 8080,
  },
  proxiesDelete: { status: "deleted" },
  proxiesChangeIp: {
    id: "proxy-1",
    ip: "203.0.113.10",
    changed_at: "2026-08-17T00:00:00Z",
  },
  usersList: [
    {
      id: "user-1",
      name: "Owner",
      email: "owner@example.test",
      status: "active",
      owner: true,
    },
  ],
  usersDisable: { status: "disabled" },
  membersList: [
    {
      id: "member-1",
      name: "Profile viewer",
      email: "viewer@example.test",
      status: "active",
      role: "viewer",
      created_at: "2026-08-17T00:00:00Z",
      updated_at: "2026-08-17T00:00:00Z",
    },
  ],
  membersShare: { status: "shared" },
  membersRemove: { status: "removed" },
  notesGet: { notes: "Current profile note", version: 1 },
  notesAppend: { version: 2 },
  notesReplace: { version: 2 },
  notesHistory: [
    {
      id: "note-1",
      version: 1,
      notes: "Current profile note",
      created_by: "user-1",
      created_at: "2026-08-17T00:00:00Z",
    },
  ],
  auditList: [
    {
      action: "profile.updated",
      entity_type: "profile",
      entity_id: "profile-1",
      actor_user_id: "user-1",
      created_at: "2026-08-17T00:00:00Z",
    },
  ],
  binaryStatus: null,
  binaryDownload: {
    path: "/tmp/cloakbrowser",
    pro: false,
    source: "official",
    trust: "verified",
  },
  binaryProgress: { downloaded: 0, total: null, done: true },
  licenseStatus: { hasLicense: false },
  licenseSet: { hasLicense: true },
  licenseClear: { hasLicense: false },
  settingsGet: {
    has_license: false,
    download_source: "official",
    custom_download_url: null,
    browser_cache_max_bytes: 536870912,
    update_channel: "stable",
  },
  settingsSet: {
    has_license: false,
    download_source: "official",
    custom_download_url: null,
    browser_cache_max_bytes: 536870912,
    update_channel: "stable",
  },
  updatesCheck: {
    channel: "stable",
    updateAvailable: false,
    updateReady: false,
  },
  updatesDownload: {
    channel: "stable",
    updateAvailable: false,
    updateReady: false,
  },
  updatesApply: {
    channel: "stable",
    updateAvailable: true,
    updateReady: false,
  },
  cliInstall: { installed: false, message: "CLI not installed" },
  logsTail: { lines: [] },
};

export function createMockBridge(
  overrides: Partial<Record<AppRPCMethod, unknown>> = {},
): Bridge {
  let connected =
    typeof window === "undefined" ||
    new URLSearchParams(window.location.search).get("setup") !== "1";
  const calls: Array<{ method: AppRPCMethod; params: unknown }> = [];
  let liveSessions: Array<Record<string, unknown>> = [];
  let hasLicense = false;
  if (typeof window !== "undefined") window.__browserloginMockCalls = calls;
  return {
    async request<K extends AppRPCMethod>(
      method: K,
      params: BridgeParams<K>,
    ): Promise<RpcReply<BridgeResult<K>>> {
      AppRPCSchemas[method].params.parse(params);
      calls.push({ method, params: structuredClone(params) });
      if (method === "connectionGet") {
        const override = overrides.connectionGet as
          Record<string, unknown> | undefined;
        const value = AppRPCSchemas.connectionGet.result.parse({
          ...(values.connectionGet as Record<string, unknown>),
          ...override,
          hasApiKey: override?.hasApiKey ?? connected,
        }) as BridgeResult<K>;
        return { ok: true, value };
      }
      if (method === "connectionSet") connected = true;
      if (method === "connectionClear") connected = false;
      if (method === "licenseSet") hasLicense = true;
      if (method === "licenseClear") hasLicense = false;
      if (method === "licenseStatus") {
        return {
          ok: true,
          value: AppRPCSchemas.licenseStatus.result.parse({
            hasLicense,
          }) as BridgeResult<K>,
        };
      }
      if (method === "updatesCheck" || method === "updatesDownload") {
        const available =
          typeof window !== "undefined" &&
          new URLSearchParams(window.location.search).get("update") ===
            "available";
        return {
          ok: true,
          value: AppRPCSchemas[method].result.parse({
            channel: "stable",
            updateAvailable: available,
            updateReady: method === "updatesDownload" && available,
            ...(available ? { version: "0.2.0" } : {}),
          }) as BridgeResult<K>,
        };
      }
      if (method === "usersList") {
        const owner =
          typeof window === "undefined" ||
          new URLSearchParams(window.location.search).get("owner") !== "0";
        const value = AppRPCSchemas.usersList.result.parse([
          {
            id: "user-1",
            name: owner ? "Workspace owner" : "Workspace member",
            email: "member@example.test",
            status: "active",
            owner,
          },
        ]) as BridgeResult<K>;
        return { ok: true, value };
      }
      if (method === "sessionsStart") {
        const profileId = (params as { profileId: string }).profileId;
        liveSessions = [
          ...liveSessions.filter((session) => session.profile_id !== profileId),
          {
            profile_id: profileId,
            status: "running",
            started_at: new Date().toISOString(),
            generation: 1,
            archive_generation: 4,
          },
        ];
        return {
          ok: true,
          value: AppRPCSchemas.sessionsStart.result.parse(
            liveSessions.at(-1),
          ) as BridgeResult<K>,
        };
      }
      if (method === "sessionsLive") {
        return {
          ok: true,
          value: AppRPCSchemas.sessionsLive.result.parse(
            liveSessions,
          ) as BridgeResult<K>,
        };
      }
      if (method === "sessionsStop" || method === "sessionsForceStop") {
        const profileId = (params as { profileId: string }).profileId;
        liveSessions = liveSessions.filter(
          (session) => session.profile_id !== profileId,
        );
      }
      if (
        method === "profilesUpdate" &&
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("conflict") === "1"
      ) {
        return {
          ok: false,
          error: { code: "CONFLICT", message: "Profile changed remotely" },
        };
      }
      if (
        (method === "notesAppend" || method === "notesReplace") &&
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("notesConflict") === "1"
      ) {
        return {
          ok: false,
          error: { code: "CONFLICT", message: "Notes changed remotely" },
        };
      }
      const value = AppRPCSchemas[method].result.parse(
        overrides[method] ?? values[method],
      ) as BridgeResult<K>;
      return { ok: true, value };
    },
  };
}

declare global {
  interface Window {
    __browserloginMockCalls?: Array<{
      method: AppRPCMethod;
      params: unknown;
    }>;
  }
}

export function createDefaultBridge(): Bridge {
  return typeof window !== "undefined" && "__electrobun" in window
    ? {
        async request<K extends AppRPCMethod>(
          method: K,
          params: BridgeParams<K>,
        ) {
          const bridge = await createElectrobunBridgeLazy();
          return bridge.request(method, params);
        },
      }
    : createMockBridge();
}

let electrobunBridge: Promise<Bridge> | undefined;
function createElectrobunBridgeLazy(): Promise<Bridge> {
  electrobunBridge ??= import("./rpc-client.js").then(
    ({ createElectrobunBridge }) => createElectrobunBridge(),
  );
  return electrobunBridge;
}
