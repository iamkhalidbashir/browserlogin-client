import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REMOTE_TOOL_NAMES } from "../mocks/remote-mcp-server.js";

const fixture = (name: string): Record<string, unknown> => JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures", name), "utf8")) as Record<string, unknown>;

describe("Task 2 Python parity fixtures", () => {
  it("loads every golden contract with source provenance", () => {
    for (const name of ["rest/requests.json", "rest/responses.json", "rest/errors.json", "cli/output.json", "launch/args.json", "proxy/matrix.json", "archive/limits.json", "recovery/transitions.json", "connection/schema.json"]) {
      const data = fixture(name);
      expect(data.provenance).toMatch(/\.py:\d+-\d+/);
    }
  });

  it("asserts the exact documented remote MCP tool set", () => {
    expect(REMOTE_TOOL_NAMES).toEqual(["profiles_list", "profile_get", "profile_create", "profile_update", "profile_delete", "profile_restore", "notes_get", "notes_append", "notes_update", "proxies_list", "proxy_change_ip", "members_list", "member_share", "member_remove", "users_list", "user_disable", "audit_list"]);
    expect(new Set(REMOTE_TOOL_NAMES).size).toBe(17);
  });

  it("keeps archive limits and tamper evidence explicit", () => {
    const data = fixture("archive/limits.json");
    expect(data.defaults).toMatchObject({ maxArchiveBytes: 512 * 1024 * 1024, maxFiles: 100000, maxCompressionRatio: 200 });
    expect(data.tamperScenario).toMatchObject({ original: "DATA", tampered: "D4TA" });
  });
});
