import { z } from "zod";

export const CONNECTION_SCHEMA_VERSION = 3 as const;
export const DEFAULT_BROWSER_CACHE_BYTES = 512 * 1024 * 1024;
export const MAX_BROWSER_CACHE_BYTES = 8 * 1024 * 1024 * 1024;

const httpsUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), "must use HTTPS");

const appOrigin = httpsUrl.refine((value) => {
  const parsed = new URL(value);
  return (
    !parsed.username &&
    !parsed.password &&
    !parsed.search &&
    !parsed.hash &&
    (parsed.pathname === "" || parsed.pathname === "/")
  );
}, "must be an application origin without a path");

export const ConnectionConfigSchema = z
  .object({
    schema_version: z.literal(CONNECTION_SCHEMA_VERSION),
    app_origin: appOrigin,
    has_api_key: z.boolean(),
  })
  .strict();

export const LocalSettingsSchema = z
  .object({
    has_license: z.boolean().default(false),
    download_source: z.enum(["official", "custom"]).default("official"),
    custom_download_url: httpsUrl.nullable().default(null),
    browser_cache_max_bytes: z
      .number()
      .int()
      .min(0)
      .max(MAX_BROWSER_CACHE_BYTES)
      .default(DEFAULT_BROWSER_CACHE_BYTES),
    update_channel: z.enum(["stable", "beta"]).default("stable"),
  })
  .strict()
  .superRefine((settings, context) => {
    if (
      settings.download_source === "custom" &&
      settings.custom_download_url === null
    ) {
      context.addIssue({
        code: "custom",
        message: "custom_download_url is required for a custom download source",
        path: ["custom_download_url"],
      });
    }
  });

export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>;
export type LocalSettings = z.infer<typeof LocalSettingsSchema>;
