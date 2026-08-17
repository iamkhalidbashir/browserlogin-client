import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REMOTE_TOOL_NAMES } from "../mocks/remote-mcp-server.js";

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../fixtures", name), "utf8"),
  ) as Record<string, unknown>;

describe("Task 2 Python parity fixtures", () => {
  it("loads every golden contract with source provenance", () => {
    for (const name of [
      "rest/requests.json",
      "rest/responses.json",
      "rest/errors.json",
      "cli/output.json",
      "launch-args.json",
      "proxy/matrix.json",
      "archive/limits.json",
      "recovery/transitions.json",
      "connection/schema.json",
    ]) {
      const data = fixture(name);
      const provenances: string[] = [];
      const collect = (value: unknown): void => {
        if (Array.isArray(value)) {
          value.forEach(collect);
          return;
        }
        if (!value || typeof value !== "object") return;
        for (const [key, nested] of Object.entries(value)) {
          if (key === "provenance" && typeof nested === "string")
            provenances.push(nested);
          collect(nested);
        }
      };
      collect(data);
      expect(provenances.length).toBeGreaterThan(0);
      for (const provenance of provenances)
        expect(provenance).toMatch(/browserlogin_client\/[a-z_]+\.py:\d+-\d+/);
    }
  });

  it("asserts the exact documented remote MCP tool set", () => {
    expect(REMOTE_TOOL_NAMES).toEqual([
      "profiles_list",
      "profile_get",
      "profile_create",
      "profile_update",
      "profile_delete",
      "profile_restore",
      "notes_get",
      "notes_append",
      "notes_update",
      "proxies_list",
      "proxy_change_ip",
      "members_list",
      "member_share",
      "member_remove",
      "users_list",
      "user_disable",
      "audit_list",
    ]);
    expect(new Set(REMOTE_TOOL_NAMES).size).toBe(17);
  });

  it("keeps archive limits and tamper evidence explicit", () => {
    const data = fixture("archive/limits.json");
    expect(data.defaults).toMatchObject({
      maxArchiveBytes: 512 * 1024 * 1024,
      maxFiles: 100000,
      maxCompressionRatio: 200,
    });
    expect(data.tamperScenario).toMatchObject({
      original: "DATA",
      tampered: "D4TA",
    });
  });

  it("locks CLI table fields, force prompt, and protected launch argv", () => {
    const cli = fixture("cli/output.json");
    expect(cli.profilesTableFields).toEqual([
      "profile_id",
      "name",
      "platform",
      "archive_generation",
      "cloud_session",
    ]);
    expect(cli.forcePrompt).toMatchObject({
      phrase: "FORCE CLOSE <profile_id>",
      example: "FORCE CLOSE profile-1",
    });
    const launch = fixture("launch-args.json");
    expect(launch.protectedArgvEntries).toEqual([
      "--fingerprint=",
      "--disk-cache-dir=",
      "--disk-cache-size=",
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
    ]);
    expect(launch.profiles).toHaveLength(3);
    expect(
      (launch.profiles as Array<{ expectedArgv: string[] }>).at(-1)
        ?.expectedArgv,
    ).toContain("--fingerprint-platform=windows");
  });
});
