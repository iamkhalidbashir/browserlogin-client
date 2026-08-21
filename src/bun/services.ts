import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Profile, Proxy } from "../shared/api-types.js";
import {
  DEFAULT_BROWSER_CACHE_BYTES,
  LocalSettingsSchema,
  type LocalSettings,
} from "../shared/config-types.js";
import {
  KEYCHAIN_API_ACCOUNT,
  KEYCHAIN_LICENSE_ACCOUNT,
  KEYCHAIN_SERVICE,
} from "../shared/keychain-types.js";
import { BrowserLoginClient } from "../core/api/client.js";
import type {
  ProfileCreateInput,
  ProfileUpdateInput,
  ProxyInput,
} from "../core/api/client.js";
import {
  BrowserInitializationRequiredError,
  ensureBinary,
  readActiveBinary,
} from "../core/binary/index.js";
import type { BinaryInfo } from "../core/binary/types.js";
import {
  ConnectionStore,
  validateAppOrigin,
} from "../core/config/connection.js";
import { statePaths } from "../core/config/paths.js";
import { atomicWriteJson, readJson } from "../core/config/store.js";
import { LifecycleCoordinator } from "../core/coordinator/index.js";
import type { KeychainFacade } from "../core/keychain/index.js";
import type { AppServices, BinaryProgress } from "./rpc.js";
import { UpdateController } from "./updater.js";

export type AppServiceContext = {
  root: string;
  connection: ConnectionStore;
  keychain: KeychainFacade;
  updateController: UpdateController;
  emitProgress: (progress: BinaryProgress) => void;
  installCli?: () => Promise<{
    installed: boolean;
    path?: string;
    message: string;
  }>;
  client?: BrowserLoginClient;
  coordinator?: Pick<
    LifecycleCoordinator,
    "start" | "stop" | "forceStop" | "recover"
  >;
  ensureBinary?: typeof ensureBinary;
  readActiveBinary?: typeof readActiveBinary;
};

type ProfileParams = { profileId: string };
type ProxyParams = { proxyId: string };
type UserParams = { userId: string };

const defaultSettings = (hasLicense: boolean): LocalSettings => ({
  has_license: hasLicense,
  download_source: "official",
  custom_download_url: null,
  browser_cache_max_bytes: DEFAULT_BROWSER_CACHE_BYTES,
  update_channel: "stable",
});

function stripProxySecret(proxy: Proxy | null): Omit<Proxy, "password"> | null {
  if (!proxy) return null;
  const safe = { ...proxy };
  delete safe.password;
  return safe;
}

function stripProfileSecrets(profile: Profile) {
  return { ...profile, proxy: stripProxySecret(profile.proxy) };
}

async function readSettings(
  root: string,
  keychain: KeychainFacade,
): Promise<LocalSettings> {
  const license = await keychain.getLicenseKey();
  const stored = await readJson<unknown>(join(root, "settings.json"));
  if (stored === null) return defaultSettings(Boolean(license));
  return LocalSettingsSchema.parse({
    ...stored,
    has_license: Boolean(license),
    update_channel: "stable",
  });
}

async function writeSettings(
  root: string,
  settings: LocalSettings,
): Promise<void> {
  const persisted = {
    download_source: settings.download_source,
    custom_download_url: settings.custom_download_url,
    browser_cache_max_bytes: settings.browser_cache_max_bytes,
    update_channel: settings.update_channel,
  };
  await atomicWriteJson(join(root, "settings.json"), persisted);
}

async function tailLog(root: string, lines: number): Promise<string[]> {
  const path = join(statePaths(root).logs, "mcp.log");
  const text = await readFile(path, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    },
  );
  return text.split(/\r?\n/).filter(Boolean).slice(-lines);
}

async function resolveClient(connection: ConnectionStore): Promise<{
  client: BrowserLoginClient;
  licenseKey: string | null;
}> {
  const resolved = await connection.resolve();
  if (!resolved.apiKey)
    throw Object.assign(new Error("setup required"), {
      code: "SETUP_REQUIRED",
    });
  return {
    client: new BrowserLoginClient({
      baseUrl: resolved.restBaseUrl,
      credentials: async () => resolved.apiKey!,
    }),
    licenseKey: resolved.licenseKey,
  };
}

function createCoordinator(
  root: string,
  client: BrowserLoginClient,
): LifecycleCoordinator {
  return new LifecycleCoordinator({
    root,
    api: client,
    profile: async (profileId) => {
      const binary = await readActiveBinary(root, { env: process.env });
      if (!binary) throw new BrowserInitializationRequiredError();
      const profile = await client.getProfile(profileId);
      return {
        profile,
        binary,
        launchSpec: {
          profile_id: profile.id,
          seed: profile.seed,
          platform: profile.platform as "macos" | "linux" | "windows",
          geoip: profile.geoip,
          humanize: profile.humanize,
          human_preset: profile.human_preset,
          bumblebee_profile: profile.bumblebee_profile,
          headless: profile.headless,
          timezone: profile.timezone,
          locale: profile.locale,
          user_agent: profile.user_agent,
          viewport: profile.viewport as {
            width: number;
            height: number;
          } | null,
          args: profile.args,
          proxy: profile.proxy
            ? {
                protocol: profile.proxy.protocol,
                host: profile.proxy.host,
                port: profile.proxy.port,
                username: profile.proxy.username ?? null,
                password: profile.proxy.password ?? null,
              }
            : null,
        },
      };
    },
  });
}

export function createCoreAppRuntime(context: AppServiceContext): {
  services: AppServices;
  recover: () => Promise<void>;
} {
  const live = new Map<string, Record<string, unknown>>();
  let lastBinary: BinaryInfo | null = null;
  let progress: BinaryProgress = { downloaded: 0, total: null, done: true };
  let coordinatorPromise: Promise<LifecycleCoordinator> | undefined;

  const client = async () =>
    context.client ?? (await resolveClient(context.connection)).client;
  const coordinator = async () => {
    if (context.coordinator) return context.coordinator;
    coordinatorPromise ??= (async () => {
      const resolved = await resolveClient(context.connection);
      return createCoordinator(context.root, resolved.client);
    })();
    return coordinatorPromise;
  };

  const services: AppServices = {
    connectionGet: async () => {
      const resolved = await context.connection.resolve();
      return {
        appOrigin: resolved.appOrigin,
        hasApiKey: Boolean(resolved.apiKey),
        hasLicense: Boolean(resolved.licenseKey),
      };
    },
    connectionSet: async (raw) => {
      const params = raw as { appOrigin: string; apiKey: string };
      await context.connection.save(params.appOrigin, params.apiKey);
      coordinatorPromise = undefined;
      return {
        appOrigin: validateAppOrigin(params.appOrigin),
        hasApiKey: true as const,
      };
    },
    connectionTest: async () => {
      const resolved = await context.connection.resolve();
      if (!resolved.apiKey) return { connected: false, hasApiKey: false };
      await (await client()).getUser();
      return { connected: true, hasApiKey: true };
    },
    connectionClear: async () => {
      await context.keychain.delete({
        service: KEYCHAIN_SERVICE,
        account: KEYCHAIN_API_ACCOUNT,
      });
      await import("node:fs/promises").then(({ rm }) =>
        rm(context.connection.paths.connection, { force: true }),
      );
      coordinatorPromise = undefined;
      return { hasApiKey: false as const };
    },
    profilesList: async () =>
      (await (await client()).listProfiles()).map(stripProfileSecrets),
    profilesGet: async (raw) =>
      stripProfileSecrets(
        await (await client()).getProfile((raw as ProfileParams).profileId),
      ),
    profilesCreate: async (raw) =>
      stripProfileSecrets(
        await (await client()).createProfile(raw as ProfileCreateInput),
      ),
    profilesUpdate: async (raw) => {
      const { profileId, expectedConfigVersion, ...fields } =
        raw as ProfileParams &
          Record<string, unknown> & { expectedConfigVersion: number };
      return stripProfileSecrets(
        await (
          await client()
        ).updateProfile(profileId, {
          ...fields,
          expected_config_version: expectedConfigVersion,
        } as ProfileUpdateInput),
      );
    },
    profilesDelete: async (raw) =>
      (await client()).deleteProfile((raw as ProfileParams).profileId),
    profilesRestore: async (raw) =>
      (await client()).restoreProfile((raw as ProfileParams).profileId),
    sessionsStart: async (raw) => {
      const profileId = (raw as ProfileParams).profileId;
      const state = await (await coordinator()).start(profileId);
      const summary = { ...state } as Record<string, unknown>;
      live.set(profileId, summary);
      return summary;
    },
    sessionsStop: async (raw) => {
      const profileId = (raw as ProfileParams).profileId;
      const state = await (await coordinator()).stop(profileId);
      live.delete(profileId);
      return { ...state } as Record<string, unknown>;
    },
    sessionsForceStop: async (raw) => {
      const params = raw as ProfileParams & { confirmation: string };
      if (params.confirmation !== `FORCE CLOSE ${params.profileId}`)
        throw Object.assign(new Error("confirmation mismatch"), {
          code: "CONFIRMATION_REQUIRED",
        });
      const state = await (await coordinator()).forceStop(params.profileId);
      live.delete(params.profileId);
      return { ...state } as Record<string, unknown>;
    },
    sessionsLive: async () => {
      const lifecycle = await coordinator();
      const recovered = await Promise.all(
        [...live.keys()].map(async (profileId) => ({
          profileId,
          state: await lifecycle.recover(profileId),
        })),
      );
      for (const { profileId, state } of recovered) {
        if (state) live.set(profileId, { ...state } as Record<string, unknown>);
        else live.delete(profileId);
      }
      return [...live.values()];
    },
    proxiesList: async () =>
      (await (await client()).listProxies()).map(stripProxySecret),
    proxiesCreate: async (raw) =>
      stripProxySecret(await (await client()).createProxy(raw as ProxyInput)),
    proxiesUpdate: async (raw) => {
      const { proxyId, ...input } = raw as ProxyParams & ProxyInput;
      return stripProxySecret(
        await (await client()).updateProxy(proxyId, input),
      );
    },
    proxiesDelete: async (raw) =>
      (await client()).deleteProxy((raw as ProxyParams).proxyId),
    proxiesChangeIp: async (raw) =>
      (await client()).changeProxyIp((raw as ProxyParams).proxyId),
    usersList: async () => (await client()).listUsers(),
    usersDisable: async (raw) =>
      (await client()).disableUser((raw as UserParams).userId),
    membersList: async (raw) =>
      (await client()).listMembers((raw as ProfileParams).profileId),
    membersShare: async (raw) => {
      const params = raw as ProfileParams & { userId: string; role: string };
      return (await client()).shareProfile(
        params.profileId,
        params.userId,
        params.role,
      );
    },
    membersRemove: async (raw) => {
      const params = raw as ProfileParams & UserParams;
      return (await client()).removeMember(params.profileId, params.userId);
    },
    notesGet: async (raw) =>
      (await client()).getNotes((raw as ProfileParams).profileId),
    notesAppend: async (raw) => {
      const params = raw as ProfileParams & {
        notes: string;
        expectedVersion: number;
      };
      return (await client()).appendNotes(
        params.profileId,
        params.notes,
        params.expectedVersion,
      );
    },
    notesReplace: async (raw) => {
      const params = raw as ProfileParams & {
        notes: string;
        expectedVersion: number;
      };
      return (await client()).replaceNotes(
        params.profileId,
        params.notes,
        params.expectedVersion,
      );
    },
    notesHistory: async (raw) =>
      (await client()).listNoteHistory((raw as ProfileParams).profileId),
    auditList: async (raw) =>
      (await client()).listAudit((raw as Partial<ProfileParams>).profileId),
    binaryStatus: async () => {
      if (!lastBinary)
        lastBinary =
          (await (context.readActiveBinary ?? readActiveBinary)(context.root, {
            env: process.env,
          })) ?? null;
      return lastBinary;
    },
    binaryDownload: async (raw) => {
      const params = raw as {
        advancedEnabled: boolean;
        pro?: boolean;
        source?: "free" | "license" | "custom";
        customUrl?: string;
      };
      const settings = await readSettings(context.root, context.keychain);
      const source =
        params.source ??
        (params.pro
          ? "license"
          : settings.download_source === "custom"
            ? "custom"
            : "free");
      if (source === "custom" && !params.advancedEnabled)
        throw Object.assign(new Error("advanced confirmation required"), {
          code: "ADVANCED_CONFIRMATION_REQUIRED",
        });
      const licenseKey = await context.keychain.getLicenseKey();
      if (source === "license" && !licenseKey)
        throw Object.assign(new Error("license required"), {
          code: "LICENSE_REQUIRED",
        });
      const customUrl =
        source === "custom"
          ? (params.customUrl ?? settings.custom_download_url ?? undefined)
          : undefined;
      if (source === "custom" && !customUrl)
        throw Object.assign(new Error("custom URL required"), {
          code: "CUSTOM_URL_REQUIRED",
        });
      lastBinary = await (context.ensureBinary ?? ensureBinary)({
        cacheDirectory: context.root,
        ...(source === "license" && licenseKey ? { licenseKey } : {}),
        pro: source === "license",
        ...(customUrl ? { downloadUrl: customUrl } : {}),
        totalTimeoutMs: 60 * 60 * 1000,
        progress: (event) => {
          progress = {
            downloaded: event.downloaded,
            total: event.total ?? null,
            done: event.done,
          };
          context.emitProgress(progress);
        },
      });
      return lastBinary;
    },
    binaryProgress: async () => progress,
    licenseStatus: async () => ({
      hasLicense: Boolean(await context.keychain.getLicenseKey()),
    }),
    licenseSet: async (raw) => {
      await context.keychain.setLicenseKey(
        (raw as { licenseKey: string }).licenseKey,
      );
      coordinatorPromise = undefined;
      return { hasLicense: true as const };
    },
    licenseClear: async () => {
      await context.keychain.delete({
        service: KEYCHAIN_SERVICE,
        account: KEYCHAIN_LICENSE_ACCOUNT,
      });
      coordinatorPromise = undefined;
      return { hasLicense: false as const };
    },
    settingsGet: async () => readSettings(context.root, context.keychain),
    settingsSet: async (raw) => {
      const params = raw as {
        downloadSource?: "official" | "custom";
        customDownloadUrl?: string | null;
        browserCacheMaxBytes?: number;
        advancedEnabled?: boolean;
      };
      const current = await readSettings(context.root, context.keychain);
      if (
        (params.downloadSource === "custom" || params.customDownloadUrl) &&
        !params.advancedEnabled
      )
        throw Object.assign(new Error("advanced confirmation required"), {
          code: "ADVANCED_CONFIRMATION_REQUIRED",
        });
      const next = LocalSettingsSchema.parse({
        ...current,
        download_source: params.downloadSource ?? current.download_source,
        custom_download_url:
          params.customDownloadUrl === undefined
            ? current.custom_download_url
            : params.customDownloadUrl,
        browser_cache_max_bytes:
          params.browserCacheMaxBytes ?? current.browser_cache_max_bytes,
        update_channel: "stable",
      });
      await writeSettings(context.root, next);
      coordinatorPromise = undefined;
      return next;
    },
    updatesCheck: async () => context.updateController.checkForUpdate(),
    updatesDownload: async () => context.updateController.downloadUpdate(),
    updatesApply: async (raw) =>
      context.updateController.applyAfterConfirmation(
        (raw as { confirmed: boolean }).confirmed,
      ),
    cliInstall: async () =>
      context.installCli?.() ?? {
        installed: false,
        message:
          "CLI installation becomes available with the browserlogin CLI build.",
      },
    logsTail: async (raw) => ({
      lines: await tailLog(context.root, (raw as { lines: number }).lines),
    }),
  };
  return {
    services,
    recover: async () => {
      const directory = statePaths(context.root).state;
      const files = await readdir(directory).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        },
      );
      const profileIds = new Set<string>();
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const value = JSON.parse(
          await readFile(join(directory, file), "utf8"),
        ) as {
          profile_id?: unknown;
        };
        if (typeof value.profile_id === "string")
          profileIds.add(value.profile_id);
      }
      const lifecycle = await coordinator();
      const recovered = await Promise.all(
        [...profileIds].map(async (profileId) => ({
          profileId,
          state: await lifecycle.recover(profileId),
        })),
      );
      for (const { profileId, state } of recovered) {
        if (state) live.set(profileId, { ...state } as Record<string, unknown>);
        else live.delete(profileId);
      }
    },
  };
}

export function createCoreAppServices(context: AppServiceContext): AppServices {
  return createCoreAppRuntime(context).services;
}
