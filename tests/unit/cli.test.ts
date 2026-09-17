import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { runCli, type CliIO } from "../../src/cli/index.js";
import { installCli } from "../../src/cli/support.js";
import { vendorHelperName } from "../../src/core/browser-tools/vendor.js";
import type { AppServices } from "../../src/bun/rpc.js";

function harness(prompt = "") {
  let stdout = "";
  let stderr = "";
  const io: CliIO = {
    stdout: (value) => {
      stdout += value;
    },
    stderr: (value) => {
      stderr += value;
    },
    prompt: vi.fn(async () => prompt),
  };
  return { io, stdout: () => stdout, stderr: () => stderr };
}

function services(): AppServices {
  return {
    profilesList: async () => [
      {
        id: "profile-1",
        name: "Research profile",
        platform: "macos",
        seed: 1,
        proxy: null,
        geoip: true,
        humanize: true,
        human_preset: "careful",
        bumblebee_profile: "natural",
        headless: false,
        timezone: null,
        locale: null,
        user_agent: null,
        viewport: null,
        args: [],
        cloud: { archive_generation: 4, current_session_id: null },
      },
    ],
    sessionsStart: async () => ({ status: "running" }),
    sessionsStop: async () => ({ status: "stopped" }),
    sessionsForceStop: async () => ({ status: "force-stopped" }),
  };
}

describe("standalone BrowserLogin CLI", () => {
  test("self-installs the CLI and matching browser-tools helper", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-cli-install-"));
    try {
      const release = join(root, "release");
      const destination = join(root, "bin", "browserlogin");
      const helperName = vendorHelperName();
      await mkdir(release);
      await writeFile(join(release, "browserlogin"), "cli");
      await writeFile(join(release, helperName), "helper");

      await installCli(join(release, "browserlogin"), destination);

      await expect(readFile(destination, "utf8")).resolves.toBe("cli");
      await expect(
        readFile(join(root, "bin", helperName), "utf8"),
      ).resolves.toBe("helper");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("prints only the five allowed profile fields", async () => {
    const output = harness();
    expect(
      await runCli(["profiles"], { services: services(), io: output.io }),
    ).toBe(0);
    expect(JSON.parse(output.stdout())).toEqual([
      {
        profile_id: "profile-1",
        name: "Research profile",
        platform: "macos",
        archive_generation: 4,
        cloud_session: false,
      },
    ]);
  });

  test("matches start, stop, and exact force confirmation behavior", async () => {
    const start = harness();
    expect(
      await runCli(["start", "profile-1"], {
        services: services(),
        io: start.io,
      }),
    ).toBe(0);
    expect(start.stdout()).toBe("Profile started: profile-1\n");

    const stop = harness();
    expect(
      await runCli(["stop", "profile-1"], {
        services: services(),
        io: stop.io,
      }),
    ).toBe(0);
    expect(stop.stdout()).toBe("Profile stopped: profile-1\n");

    const rejected = harness("wrong phrase");
    expect(
      await runCli(["stop", "profile-1", "--force"], {
        services: services(),
        io: rejected.io,
      }),
    ).toBe(2);
    expect(rejected.stderr()).toContain("confirmation did not match");

    const forced = harness("FORCE CLOSE profile-1");
    expect(
      await runCli(["stop", "profile-1", "--force"], {
        services: services(),
        io: forced.io,
      }),
    ).toBe(0);
    expect(forced.stdout()).toBe("Profile force closed: profile-1\n");
  });

  test("rejects --yes without --force and delegates stdio MCP", async () => {
    const invalid = harness();
    expect(
      await runCli(["stop", "profile-1", "--yes"], {
        services: services(),
        io: invalid.io,
      }),
    ).toBe(2);
    expect(invalid.stderr()).toBe("--yes is valid only with --force\n");

    const mcp = vi.fn(async () => undefined);
    expect(await runCli(["mcp"], { io: harness().io, runMcp: mcp })).toBe(0);
    expect(mcp).toHaveBeenCalledTimes(1);
  });

  test("supports setup hints and reports actionable doctor setup failure", async () => {
    const hint = harness();
    expect(
      await runCli(["setup", "--api-key-env"], {
        services: services(),
        io: hint.io,
      }),
    ).toBe(0);
    expect(hint.stdout()).toContain("BROWSERLOGIN_API_KEY");

    const connectionSet = vi.fn(async () => ({
      appOrigin: "https://example.test",
      hasApiKey: true as const,
    }));
    const setup = harness();
    setup.io.prompt = vi
      .fn()
      .mockResolvedValueOnce("https://example.test")
      .mockResolvedValueOnce("bl_test_key_value");
    expect(
      await runCli(["setup"], {
        services: { connectionSet },
        io: setup.io,
      }),
    ).toBe(0);
    expect(connectionSet).toHaveBeenCalledWith({
      appOrigin: "https://example.test",
      apiKey: "bl_test_key_value",
    });

    const doctor = harness();
    expect(
      await runCli(["doctor", "--json"], {
        root: "/tmp/browserlogin-doctor-test",
        services: {
          connectionGet: async () => {
            throw Object.assign(new Error("missing"), {
              code: "SETUP_REQUIRED",
            });
          },
        },
        io: doctor.io,
      }),
    ).toBe(2);
    expect(JSON.parse(doctor.stdout())).toMatchObject({
      connection: "setup required",
      state_dir: "/tmp/browserlogin-doctor-test",
    });
  });
});
