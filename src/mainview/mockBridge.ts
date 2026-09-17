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

const sensitiveFailureMessage =
  "Bearer launch-secret bl_launch_secret https://private.example.test/launch failed";

export const mockParams: Record<AppRPCMethod, unknown> = {
  connectionGet: {},
  connectionSet: {
    appOrigin: "https://example.test",
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
  logsTail: { lines: 500 },
};

const values: Record<AppRPCMethod, unknown> = {
  connectionGet: {
    appOrigin: "https://example.test",
    hasApiKey: true,
    hasLicense: false,
  },
  connectionSet: { appOrigin: "https://example.test", hasApiKey: true },
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
      change_ip_url: "https://proxy.example.test/change-ip",
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
    ip_verified: true,
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
  binaryStatus: {
    path: "/tmp/cloakbrowser",
    version: "1.0.0",
    platform: "darwin-arm64",
    pro: false,
    source: "official",
    trust: "verified",
  },
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
    auto_check_updates: true,
  },
  settingsSet: {
    has_license: false,
    download_source: "official",
    custom_download_url: null,
    browser_cache_max_bytes: 536870912,
    update_channel: "stable",
    auto_check_updates: true,
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
  logsTail: { lines: [] },
};

export function createMockBridge(
  overrides: Partial<Record<AppRPCMethod, unknown>> = {},
): Bridge {
  let connected =
    typeof window === "undefined" ||
    new URLSearchParams(window.location.search).get("setup") !== "1";
  let currentAppOrigin = "https://example.test";
  // Captured once at creation: the setup gate redirects "/" to "/dashboard"
  // during first render, which drops the live query string.
  const initialSearch =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  let autoCheckUpdates = initialSearch.get("autoCheck") !== "0";
  const binaryStatusControl = initialSearch.get("binaryStatus");
  const profilesListControl = initialSearch.get("profilesList");
  const sessionsStartControl = initialSearch.get("sessionsStart");
  const multi =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("multi") === "1";
  let proxyRecords = AppRPCSchemas.proxiesList.result.parse(
    initialSearch.get("proxies") === "empty"
      ? []
      : [
          ...AppRPCSchemas.proxiesList.result.parse(values.proxiesList),
          ...(multi
            ? [
                {
                  id: "proxy-2",
                  name: "Backup",
                  protocol: "socks5",
                  host: "10.0.0.2",
                  port: 1080,
                  username: null,
                  last_ip: null,
                  last_ip_changed_at: null,
                },
              ]
            : []),
        ],
  );
  const calls: Array<{ method: AppRPCMethod; params: unknown }> = [];
  let liveSessions: Array<Record<string, unknown>> =
    initialSearch.get("profileRunning") === "1"
      ? [
          {
            profile_id: profile.id,
            status: "running",
            started_at: new Date().toISOString(),
            generation: 1,
            archive_generation: 4,
          },
        ]
      : [];
  let hasLicense = false;
  let binaryInstalled = initialSearch.get("binary") !== "missing";
  let binaryStatusCalls = 0;
  let profilesListCalls = 0;
  let binaryProgress: BridgeResult<"binaryProgress"> =
    AppRPCSchemas.binaryProgress.result.parse(values.binaryProgress);
  const downloadDelayMs = (() => {
    if (typeof window === "undefined") return 0;
    const raw = new URLSearchParams(window.location.search).get(
      "downloadDelayMs",
    );
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(2000, Math.max(0, parsed));
  })();
  const binaryProgressDelayMs = (() => {
    const raw = initialSearch.get("binaryProgressDelayMs");
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(2000, Math.max(0, parsed));
  })();
  if (typeof window !== "undefined") window.__browserloginMockCalls = calls;
  return {
    async request<K extends AppRPCMethod>(
      method: K,
      params: BridgeParams<K>,
    ): Promise<RpcReply<BridgeResult<K>>> {
      AppRPCSchemas[method].params.parse(params);
      const recordedParams =
        method === "connectionSet"
          ? {
              ...AppRPCSchemas.connectionSet.params.parse(params),
              apiKey: "[REDACTED]",
            }
          : method === "licenseSet"
            ? {
                ...AppRPCSchemas.licenseSet.params.parse(params),
                licenseKey: "[REDACTED]",
              }
            : params;
      calls.push({ method, params: structuredClone(recordedParams) });
      if (method === "connectionGet") {
        const override = overrides.connectionGet as
          Record<string, unknown> | undefined;
        const stale = initialSearch.get("connectionGet") === "stale";
        const value = AppRPCSchemas.connectionGet.result.parse({
          ...(values.connectionGet as Record<string, unknown>),
          ...override,
          appOrigin: override?.appOrigin ?? currentAppOrigin,
          hasApiKey: override?.hasApiKey ?? (connected && !stale),
          hasLicense: override?.hasLicense ?? hasLicense,
        }) as BridgeResult<K>;
        return { ok: true, value };
      }
      if (
        method === "connectionSet" &&
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("connectionSet") ===
          "fail"
      ) {
        return {
          ok: false,
          error: {
            code: "CONNECTION_SAVE_FAILED",
            message: "Connection save failed: mock rejection.",
          },
        };
      }
      if (
        method === "connectionSet" &&
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("connectionSet") ===
          "reject"
      ) {
        throw new Error("Connection request failed: mock transport rejection.");
      }
      if (
        method === "connectionSet" &&
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("connectionSet") ===
          "delay"
      ) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (method === "connectionSet") {
        currentAppOrigin =
          AppRPCSchemas.connectionSet.params.parse(params).appOrigin;
        connected = true;
      }
      if (method === "connectionClear") connected = false;
      if (
        method === "connectionTest" &&
        initialSearch.get("connectionTest") === "reject"
      ) {
        throw new Error("Connection test failed: mock transport rejection.");
      }
      if (
        method === "connectionTest" &&
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("connectionTest") ===
          "fail"
      ) {
        return {
          ok: true,
          value: AppRPCSchemas.connectionTest.result.parse({
            connected: false,
            hasApiKey: true,
          }) as BridgeResult<K>,
        };
      }
      if (method === "binaryStatus") {
        binaryStatusCalls += 1;
        const delay = Number.parseInt(
          initialSearch.get("binaryStatusDelayMs") ?? "0",
          10,
        );
        if (Number.isFinite(delay) && delay > 0)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(delay, 2_000)),
          );
        const value = AppRPCSchemas.binaryStatus.result.parse(
          binaryInstalled &&
            !(
              binaryStatusControl === "missing-after-first" &&
              binaryStatusCalls > 1
            )
            ? (overrides.binaryStatus ?? values.binaryStatus)
            : null,
        ) as BridgeResult<K>;
        return { ok: true, value };
      }
      if (method === "binaryProgress") {
        if (binaryProgressDelayMs > 0)
          await new Promise((resolve) =>
            setTimeout(resolve, binaryProgressDelayMs),
          );
        if (!binaryProgress.done && binaryProgress.total !== null) {
          binaryProgress = AppRPCSchemas.binaryProgress.result.parse({
            ...binaryProgress,
            downloaded: Math.min(
              binaryProgress.total - 1,
              binaryProgress.downloaded + 25,
            ),
          });
        }
        const value = AppRPCSchemas.binaryProgress.result.parse(
          binaryProgress,
        ) as BridgeResult<K>;
        return { ok: true, value };
      }
      if (method === "binaryDownload") {
        binaryProgress = AppRPCSchemas.binaryProgress.result.parse({
          downloaded: 0,
          total: 100,
          done: false,
        });
        if (downloadDelayMs > 0)
          await new Promise((resolve) => setTimeout(resolve, downloadDelayMs));
        if (initialSearch.get("binaryDownload") === "fail") {
          binaryProgress = AppRPCSchemas.binaryProgress.result.parse({
            ...binaryProgress,
            done: true,
          });
          return {
            ok: false,
            error: {
              code: "BINARY_DOWNLOAD_FAILED",
              message: "CloakBrowser download failed: mock rejection.",
            },
          };
        }
        binaryInstalled = true;
        binaryProgress = AppRPCSchemas.binaryProgress.result.parse({
          downloaded: 100,
          total: 100,
          done: true,
        });
        const value = AppRPCSchemas.binaryDownload.result.parse(
          overrides.binaryDownload ?? values.binaryDownload,
        ) as BridgeResult<K>;
        return { ok: true, value };
      }
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
      if (method === "settingsGet") {
        const override = overrides.settingsGet as
          Record<string, unknown> | undefined;
        const value = AppRPCSchemas.settingsGet.result.parse({
          ...(values.settingsGet as Record<string, unknown>),
          ...override,
          auto_check_updates: override?.auto_check_updates ?? autoCheckUpdates,
        }) as BridgeResult<K>;
        return { ok: true, value };
      }
      if (method === "settingsSet") {
        const input = AppRPCSchemas.settingsSet.params.parse(params);
        autoCheckUpdates = input.autoCheckUpdates ?? autoCheckUpdates;
        const value = AppRPCSchemas.settingsSet.result.parse({
          ...(values.settingsSet as Record<string, unknown>),
          auto_check_updates: autoCheckUpdates,
        }) as BridgeResult<K>;
        return { ok: true, value };
      }
      if (method === "updatesCheck") {
        const input = AppRPCSchemas.updatesCheck.params.parse(params);
        if (input.mode === "latest" && !autoCheckUpdates) {
          return {
            ok: true,
            value: AppRPCSchemas.updatesCheck.result.parse(
              null,
            ) as BridgeResult<K>,
          };
        }
        const control = initialSearch.get("update");
        const failed = control === "check-error";
        const available =
          control === "available" ||
          control === "download-error" ||
          control === "apply-error";
        return {
          ok: true,
          value: AppRPCSchemas.updatesCheck.result.parse({
            channel: "stable",
            updateAvailable: failed ? false : available,
            updateReady: false,
            ...(available ? { version: "0.2.0" } : {}),
            ...(failed ? { error: "Update check failed" } : {}),
          }) as BridgeResult<K>,
        };
      }
      if (method === "updatesDownload") {
        const control = initialSearch.get("update");
        const available =
          control === "available" ||
          control === "download-error" ||
          control === "apply-error";
        return {
          ok: true,
          value: AppRPCSchemas.updatesDownload.result.parse({
            channel: "stable",
            updateAvailable: available,
            updateReady: available && control !== "download-error",
            ...(available ? { version: "0.2.0" } : {}),
            ...(control === "download-error"
              ? { error: "Update download failed" }
              : {}),
          }) as BridgeResult<K>,
        };
      }
      if (
        method === "updatesApply" &&
        initialSearch.get("update") === "apply-error"
      ) {
        return {
          ok: true,
          value: AppRPCSchemas.updatesApply.result.parse({
            channel: "stable",
            updateAvailable: true,
            updateReady: true,
            error: "Update could not be applied automatically.",
            fallbackUrl:
              "https://github.com/iamkhalidbashir/browserlogin-client/releases",
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
          ...(multi
            ? [
                {
                  id: "user-2",
                  name: "Second member",
                  email: "second@example.test",
                  status: "active",
                  owner: false,
                },
              ]
            : []),
        ]) as BridgeResult<K>;
        return { ok: true, value };
      }
      if (method === "proxiesCreate") {
        const input = AppRPCSchemas.proxiesCreate.params.parse(params);
        const value = AppRPCSchemas.proxiesCreate.result.parse({
          id: `proxy-${proxyRecords.length + 1}`,
          name: input.name,
          protocol: input.protocol,
          host: input.host,
          port: input.port,
          username: input.username ?? null,
          change_ip_url: input.change_ip_url ?? null,
          last_ip: null,
          last_ip_changed_at: null,
        });
        proxyRecords = [...proxyRecords, value];
        return { ok: true, value: value as BridgeResult<K> };
      }
      if (method === "proxiesUpdate") {
        const input = AppRPCSchemas.proxiesUpdate.params.parse(params);
        const current = proxyRecords.find(
          (candidate) => candidate.id === input.proxyId,
        );
        const value = AppRPCSchemas.proxiesUpdate.result.parse({
          id: input.proxyId,
          name: input.name,
          protocol: input.protocol,
          host: input.host,
          port: input.port,
          username: input.username ?? null,
          change_ip_url: input.change_ip_url ?? null,
          last_ip: current?.last_ip ?? null,
          last_ip_changed_at: current?.last_ip_changed_at ?? null,
        });
        proxyRecords = proxyRecords.map((candidate) =>
          candidate.id === input.proxyId ? value : candidate,
        );
        return { ok: true, value: value as BridgeResult<K> };
      }
      if (method === "profilesList") {
        profilesListCalls += 1;
        if (
          profilesListCalls > 1 &&
          (profilesListControl === "changed-after-first" ||
            profilesListControl === "fail-after-first")
        ) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        if (
          profilesListControl === "fail-after-first" &&
          profilesListCalls > 1
        ) {
          return {
            ok: false,
            error: {
              code: "PROFILES_REFRESH_FAILED",
              message: sensitiveFailureMessage,
            },
          };
        }
        if (
          profilesListControl === "changed-after-first" &&
          profilesListCalls > 1
        ) {
          const value = AppRPCSchemas.profilesList.result.parse([
            {
              ...profile,
              name: "Remote refreshed profile",
              cloud: {
                ...profile.cloud,
                current_session_id: liveSessions.some(
                  (session) => session.profile_id === profile.id,
                )
                  ? `session-${profile.id}`
                  : null,
              },
            },
          ]) as BridgeResult<K>;
          return { ok: true, value };
        }
      }
      if (method === "profilesList" && multi && !overrides.profilesList) {
        const value = AppRPCSchemas.profilesList.result.parse([
          {
            ...profile,
            cloud: {
              ...profile.cloud,
              current_session_id: liveSessions.some(
                (session) => session.profile_id === profile.id,
              )
                ? `session-${profile.id}`
                : null,
            },
          },
          {
            ...profile,
            id: "profile-2",
            name: "Secondary profile",
            platform: "linux",
            cloud: {
              archive_generation: 1,
              current_session_id: liveSessions.some(
                (session) => session.profile_id === "profile-2",
              )
                ? "session-profile-2"
                : null,
            },
          },
        ]) as BridgeResult<K>;
        return { ok: true, value };
      }
      if (
        method === "profilesList" &&
        initialSearch.get("profileProxy") === "1"
      ) {
        const assigned = {
          ...profile,
          proxy: (values.proxiesList as Array<Record<string, unknown>>)[0],
          cloud: {
            ...profile.cloud,
            current_session_id: liveSessions.some(
              (session) => session.profile_id === profile.id,
            )
              ? `session-${profile.id}`
              : null,
          },
        };
        return {
          ok: true,
          value: AppRPCSchemas.profilesList.result.parse([
            assigned,
          ]) as BridgeResult<K>,
        };
      }
      if (method === "profilesList" && !overrides.profilesList) {
        return {
          ok: true,
          value: AppRPCSchemas.profilesList.result.parse([
            {
              ...profile,
              cloud: {
                ...profile.cloud,
                current_session_id: liveSessions.some(
                  (session) => session.profile_id === profile.id,
                )
                  ? `session-${profile.id}`
                  : null,
              },
            },
          ]) as BridgeResult<K>,
        };
      }
      if (method === "proxiesList" && !overrides.proxiesList) {
        return { ok: true, value: proxyRecords as BridgeResult<K> };
      }
      if (method === "sessionsStart") {
        const delay = Number.parseInt(
          initialSearch.get("profileActionDelayMs") ?? "0",
          10,
        );
        if (Number.isFinite(delay) && delay > 0)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(delay, 2_000)),
          );
        const profileId = (params as { profileId: string }).profileId;
        if (sessionsStartControl === "reject") {
          throw new Error(sensitiveFailureMessage);
        }
        if (
          sessionsStartControl === "fail" ||
          (sessionsStartControl === "fail-profile-2" &&
            profileId === "profile-2")
        ) {
          return {
            ok: false,
            error: {
              code: "SESSION_START_FAILED",
              message: sensitiveFailureMessage,
            },
          };
        }
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
      if (
        method === "proxiesChangeIp" &&
        initialSearch.get("rotateUnverified") === "1"
      ) {
        return {
          ok: true,
          value: AppRPCSchemas.proxiesChangeIp.result.parse({
            id: (params as { proxyId: string }).proxyId,
            ip: null,
            ip_verified: false,
            changed_at: "2026-08-21T18:00:00Z",
          }) as BridgeResult<K>,
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
