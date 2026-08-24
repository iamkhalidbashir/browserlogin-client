import { rm } from "node:fs/promises";
import {
  KEYCHAIN_API_ACCOUNT,
  KEYCHAIN_LICENSE_ACCOUNT,
  KEYCHAIN_SERVICE,
} from "../../shared/keychain-types.js";
import { LocalSettingsSchema } from "../../shared/config-types.js";
import { AppRPCSchemas } from "../../shared/rpc-schema.js";
import type { ConnectionStore } from "../config/connection.js";
import { validateAppOrigin } from "../config/connection.js";
import type { KeychainFacade } from "../keychain/index.js";
import type { ApplicationClient } from "./client.js";
import {
  ApplicationOperationError,
  type ApplicationServices,
} from "./contracts.js";
import {
  readApplicationSettings,
  writeApplicationSettings,
} from "./settings.js";

type ConfigurationServicesOptions = {
  readonly root: string;
  readonly connection: ConnectionStore;
  readonly keychain: KeychainFacade;
  readonly client: ApplicationClient;
  readonly invalidateSessions: () => void;
};

export function createConfigurationServices(
  options: ConfigurationServicesOptions,
): ApplicationServices {
  const invalidate = () => {
    options.client.invalidate();
    options.invalidateSessions();
  };
  return {
    connectionGet: async () => {
      const resolved = await options.connection.resolve();
      return {
        appOrigin: resolved.appOrigin,
        hasApiKey: Boolean(resolved.apiKey),
        hasLicense: Boolean(resolved.licenseKey),
      };
    },
    connectionSet: async (raw) => {
      const input = AppRPCSchemas.connectionSet.params.parse(raw);
      await options.connection.save(input.appOrigin, input.apiKey);
      invalidate();
      return {
        appOrigin: validateAppOrigin(input.appOrigin),
        hasApiKey: true as const,
      };
    },
    connectionTest: async () => {
      const resolved = await options.connection.resolve();
      if (!resolved.apiKey) return { connected: false, hasApiKey: false };
      await (await options.client.client()).getUser();
      return { connected: true, hasApiKey: true };
    },
    connectionClear: async () => {
      await options.keychain.delete({
        service: KEYCHAIN_SERVICE,
        account: KEYCHAIN_API_ACCOUNT,
      });
      await rm(options.connection.paths.connection, { force: true });
      invalidate();
      return { hasApiKey: false as const };
    },
    licenseStatus: async () => ({
      hasLicense: Boolean(await options.keychain.getLicenseKey()),
    }),
    licenseSet: async (raw) => {
      const input = AppRPCSchemas.licenseSet.params.parse(raw);
      await options.keychain.setLicenseKey(input.licenseKey);
      invalidate();
      return { hasLicense: true as const };
    },
    licenseClear: async () => {
      await options.keychain.delete({
        service: KEYCHAIN_SERVICE,
        account: KEYCHAIN_LICENSE_ACCOUNT,
      });
      invalidate();
      return { hasLicense: false as const };
    },
    settingsGet: async () =>
      readApplicationSettings(options.root, options.keychain),
    settingsSet: async (raw) => {
      const input = AppRPCSchemas.settingsSet.params.parse(raw);
      const current = await readApplicationSettings(
        options.root,
        options.keychain,
      );
      if (
        (input.downloadSource === "custom" || input.customDownloadUrl) &&
        !input.advancedEnabled
      )
        throw new ApplicationOperationError(
          "ADVANCED_CONFIRMATION_REQUIRED",
          "advanced confirmation required",
          false,
        );
      const next = LocalSettingsSchema.parse({
        ...current,
        download_source: input.downloadSource ?? current.download_source,
        custom_download_url:
          input.customDownloadUrl === undefined
            ? current.custom_download_url
            : input.customDownloadUrl,
        browser_cache_max_bytes:
          input.browserCacheMaxBytes ?? current.browser_cache_max_bytes,
        update_channel: "stable",
      });
      await writeApplicationSettings(options.root, next);
      options.invalidateSessions();
      return next;
    },
  };
}
