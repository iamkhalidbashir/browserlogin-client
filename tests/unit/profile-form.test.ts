import { describe, expect, test } from "vitest";
import { ProfileSchema } from "../../src/shared/api-types.js";
import {
  DEFAULT_PROFILE_FORM,
  profileViewportForUpdate,
  profileToForm,
} from "../../src/mainview/features/profiles/profile-form.js";

const profile = ProfileSchema.parse({
  id: "profile-1",
  name: "Research profile",
  seed: 42,
  proxy: null,
  platform: "macos",
  geoip: true,
  humanize: true,
  human_preset: "careful",
  bumblebee_profile: "natural",
  headless: false,
  timezone: "America/Los_Angeles",
  locale: "en-US",
  user_agent: null,
  viewport: { width: 1280, height: 720 },
  args: [],
  cloud: {},
});

describe("profileToForm", () => {
  test("preserves a valid viewport", () => {
    expect(profileToForm(profile).viewport).toEqual({
      width: 1280,
      height: 720,
    });
  });

  test("uses editor defaults when the API returns a null viewport", () => {
    expect(profileToForm({ ...profile, viewport: null }).viewport).toEqual(
      DEFAULT_PROFILE_FORM.viewport,
    );
  });

  test("preserves a null viewport when its displayed defaults are unchanged", () => {
    expect(
      profileViewportForUpdate(null, DEFAULT_PROFILE_FORM.viewport),
    ).toBeNull();
  });

  test("submits explicit dimensions when a defaulted viewport is edited", () => {
    expect(
      profileViewportForUpdate(null, { width: 1280, height: 720 }),
    ).toEqual({ width: 1280, height: 720 });
  });
});
