import { describe, expect, test } from "vitest";
import { profileLaunchSpec } from "../../src/core/app/profile-launch.js";
import { ProfileSchema } from "../../src/shared/api-types.js";

describe("application profile launch mapping", () => {
  test("preserves proxy credentials only in the internal launch spec", () => {
    const profile = ProfileSchema.parse({
      id: "profile-1",
      name: "Profile",
      seed: 42,
      proxy: {
        id: "proxy-1",
        name: "Proxy",
        protocol: "socks5",
        host: "127.0.0.1",
        port: 1080,
        username: "runner-user",
        password: "runner-secret",
      },
      platform: "macos",
      geoip: true,
      humanize: true,
      human_preset: "careful",
      bumblebee_profile: "natural",
      headless: false,
      timezone: null,
      locale: null,
      user_agent: null,
      viewport: { width: 1280, height: 720 },
      args: ["--test"],
      cloud: {},
    });

    expect(profileLaunchSpec(profile)).toMatchObject({
      profile_id: "profile-1",
      platform: "macos",
      proxy: {
        protocol: "socks5",
        host: "127.0.0.1",
        port: 1080,
        username: "runner-user",
        password: "runner-secret",
      },
    });
  });
});
