import type { Profile } from "../../../shared/api-types.js";

export type ProfileForm = {
  name: string;
  seed: number;
  proxy_id: string | null;
  platform: "macos" | "windows" | "linux";
  geoip: boolean;
  humanize: boolean;
  human_preset: "default" | "careful";
  bumblebee_profile: "default" | "precise" | "fast" | "natural" | "messy";
  headless: boolean;
  timezone: string;
  locale: string;
  user_agent: string;
  viewport: { width: number; height: number };
  args: string[];
};

export const DEFAULT_PROFILE_FORM: ProfileForm = {
  name: "",
  seed: 42,
  proxy_id: null,
  platform: "macos",
  geoip: true,
  humanize: true,
  human_preset: "careful",
  bumblebee_profile: "natural",
  headless: false,
  timezone: "America/Los_Angeles",
  locale: "en-US",
  user_agent: "",
  viewport: { width: 1440, height: 900 },
  args: [],
};

function parseViewport(value: unknown): ProfileForm["viewport"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const width = Reflect.get(value, "width");
  const height = Reflect.get(value, "height");
  if (
    typeof width !== "number" ||
    !Number.isFinite(width) ||
    typeof height !== "number" ||
    !Number.isFinite(height)
  )
    return null;
  return { width, height };
}

export function profileViewportForUpdate(
  original: unknown,
  edited: ProfileForm["viewport"],
): ProfileForm["viewport"] | null {
  if (parseViewport(original)) return edited;
  return edited.width === DEFAULT_PROFILE_FORM.viewport.width &&
    edited.height === DEFAULT_PROFILE_FORM.viewport.height
    ? null
    : edited;
}

export function profileToForm(profile: Profile): ProfileForm {
  return {
    ...DEFAULT_PROFILE_FORM,
    name: profile.name,
    seed: profile.seed,
    proxy_id: profile.proxy?.id ?? null,
    platform:
      profile.platform === "windows" || profile.platform === "linux"
        ? profile.platform
        : "macos",
    geoip: profile.geoip,
    humanize: profile.humanize,
    human_preset: profile.human_preset,
    bumblebee_profile: profile.bumblebee_profile,
    headless: profile.headless,
    timezone: profile.timezone ?? "",
    locale: profile.locale ?? "",
    user_agent: profile.user_agent ?? "",
    viewport: parseViewport(profile.viewport) ?? {
      ...DEFAULT_PROFILE_FORM.viewport,
    },
    args: [...profile.args],
  };
}
