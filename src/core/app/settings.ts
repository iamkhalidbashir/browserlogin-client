import { join } from "node:path";
import {
  DEFAULT_BROWSER_CACHE_BYTES,
  LocalSettingsSchema,
  type LocalSettings,
} from "../../shared/config-types.js";
import type { KeychainFacade } from "../keychain/index.js";
import { atomicWriteJson, readJson } from "../config/store.js";

function defaultSettings(hasLicense: boolean): LocalSettings {
  return {
    has_license: hasLicense,
    download_source: "official",
    custom_download_url: null,
    browser_cache_max_bytes: DEFAULT_BROWSER_CACHE_BYTES,
    update_channel: "stable",
  };
}

export async function readApplicationSettings(
  root: string,
  keychain: Pick<KeychainFacade, "getLicenseKey">,
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

export async function writeApplicationSettings(
  root: string,
  settings: LocalSettings,
): Promise<void> {
  await atomicWriteJson(join(root, "settings.json"), {
    download_source: settings.download_source,
    custom_download_url: settings.custom_download_url,
    browser_cache_max_bytes: settings.browser_cache_max_bytes,
    update_channel: settings.update_channel,
  });
}
