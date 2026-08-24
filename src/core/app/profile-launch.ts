import type { Profile } from "../../shared/api-types.js";
import type { LaunchSpec } from "../runner/types.js";

export type ProfileLaunchSpec = Omit<
  LaunchSpec,
  "user_data_dir" | "browser_cache_dir" | "browser_cache_max_bytes"
>;

function viewport(value: unknown): { width: number; height: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const width = Reflect.get(value, "width");
  const height = Reflect.get(value, "height");
  return typeof width === "number" && typeof height === "number"
    ? { width, height }
    : null;
}

function platform(value: string): ProfileLaunchSpec["platform"] {
  if (value === "macos" || value === "linux" || value === "windows")
    return value;
  throw new TypeError("profile platform is invalid");
}

export function profileLaunchSpec(profile: Profile): ProfileLaunchSpec {
  return {
    profile_id: profile.id,
    seed: profile.seed,
    platform: platform(profile.platform),
    geoip: profile.geoip,
    humanize: profile.humanize,
    human_preset: profile.human_preset,
    bumblebee_profile: profile.bumblebee_profile,
    headless: profile.headless,
    timezone: profile.timezone,
    locale: profile.locale,
    user_agent: profile.user_agent,
    viewport: viewport(profile.viewport),
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
  };
}
