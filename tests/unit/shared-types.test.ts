import { describe, expect, it } from "vitest";
import responses from "../fixtures/rest/responses.json";
import connection from "../fixtures/connection/schema.json";
import {
  ApiKeyMetadataSchema,
  ArchiveIdentitySchema,
  AuditEventSchema,
  MemberSchema,
  NoteVersionSchema,
  ProfileSchema,
  ProxySchema,
  SessionSchema,
  StartResponseSchema,
  UserSchema,
} from "../../src/shared/api-types";
import {
  ConnectionConfigSchema,
  LocalSettingsSchema,
} from "../../src/shared/config-types";
import {
  ConflictError,
  KeychainError,
  PreconditionError,
} from "../../src/shared/errors";
import {
  redact,
  redactString,
  safeErrorMessage,
  serializeError,
} from "../../src/shared/redaction";

const proxy = {
  id: "proxy-1",
  name: "Residential test",
  protocol: "http",
  host: "proxy.example.test",
  port: 8443,
  username: "proxy-user",
  password: "TEST-ONLY-not-production",
  change_ip_url: "https://proxy.test/change-ip",
};
const profile = { ...responses.profile, proxy };
const session = responses.session;
const archive = responses.archive;

describe("shared API contracts", () => {
  it("parses at least 25 documented and fixture examples", () => {
    const examples = [
      responses.profile,
      profile,
      session,
      archive,
      responses.stop,
      responses.forceStop,
      { ...responses.profile, extra_field: true },
      { ...proxy, last_ip: null },
      { ...proxy, password: null },
      { ...session, heartbeat_at: null, expires_at: null, stopped_at: null },
      { ...session, state: "stopped", status: "stopped" },
      { ...archive, download_url: "/archive" },
      { ...archive, format: "tar.gz" },
      {
        id: "user-1",
        name: "Owner",
        email: "owner@example.test",
        status: "active",
        owner: true,
      },
      {
        id: "user-2",
        name: "Editor",
        email: "editor@example.test",
        status: "active",
        owner: false,
      },
      { ...proxy, protocol: "socks5", port: 1080 },
      { ...proxy, username: null, password: null },
      { ...profile, viewport: { width: 1440, height: 900 } },
      {
        ...profile,
        cloud: { ...profile.cloud, current_session_id: "session-1" },
      },
      {
        id: "note-1",
        version: 2,
        notes: "Current notes",
        created_by: "user-1",
        created_at: "2026-08-11T12:00:00.000Z",
      },
      {
        id: "member-1",
        name: "Editor",
        email: "editor@example.test",
        status: "active",
        role: "editor",
        created_at: "2026-08-11T12:00:00.000Z",
        updated_at: "2026-08-11T12:00:00.000Z",
      },
      {
        id: "key-1",
        name: "Automation",
        prefix: "bl_test",
        status: "active",
        expires_at: null,
        last_used_at: null,
        revoked_at: null,
        created_at: "2026-08-11T11:00:00.000Z",
      },
      {
        action: "profile.updated",
        entity_type: "browserProfile",
        entity_id: "profile-1",
        actor_user_id: "user-1",
        created_at: "2026-08-11T12:00:00.000Z",
      },
      {
        profile_id: "profile-1",
        generation: 4,
        size: 1,
        sha256: "a".repeat(64),
        format: "zip",
      },
      { session: { ...session }, profile, archive: null },
      { session: { ...session }, profile, archive },
      { ...responses.stop, archive_generation: 6 },
    ];
    const parsed = [
      ProfileSchema.parse(examples[0]),
      ProfileSchema.parse(examples[1]),
      SessionSchema.parse(examples[2]),
      ArchiveIdentitySchema.parse(examples[3]),
      SessionSchema.parse(examples[4]),
      SessionSchema.parse(examples[5]),
      ProfileSchema.parse(examples[6]),
      ProxySchema.parse(examples[7]),
      ProxySchema.parse(examples[8]),
      SessionSchema.parse(examples[9]),
      SessionSchema.parse(examples[10]),
      ArchiveIdentitySchema.parse(examples[11]),
      ArchiveIdentitySchema.parse(examples[12]),
      UserSchema.parse(examples[13]),
      UserSchema.parse(examples[14]),
      ProxySchema.parse(examples[15]),
      ProxySchema.parse(examples[16]),
      ProfileSchema.parse(examples[17]),
      ProfileSchema.parse(examples[18]),
      NoteVersionSchema.parse(examples[19]),
      MemberSchema.parse(examples[20]),
      ApiKeyMetadataSchema.parse(examples[21]),
      AuditEventSchema.parse(examples[22]),
      ArchiveIdentitySchema.parse(examples[23]),
      StartResponseSchema.parse(examples[24]),
      StartResponseSchema.parse(examples[25]),
      SessionSchema.parse(examples[26]),
    ];
    expect(parsed).toHaveLength(27);
  });

  it("preserves unknown response fields", () => {
    const parsed = ProfileSchema.parse({
      ...profile,
      future_field: { enabled: true },
    });
    expect(parsed.future_field).toEqual({ enabled: true });
  });

  it("keeps connection configuration secret-free and applies settings defaults", () => {
    const parsed = ConnectionConfigSchema.parse({
      schema_version: 2,
      base_url: connection.valid.base_url,
      has_api_key: true,
    });
    expect(parsed).not.toHaveProperty("api_key");
    expect(LocalSettingsSchema.parse({})).toMatchObject({
      has_license: false,
      download_source: "official",
      browser_cache_bytes: 512 * 1024 * 1024,
      update_channel: "stable",
    });
    expect(() =>
      LocalSettingsSchema.parse({ download_source: "custom" }),
    ).toThrow();
    expect(() =>
      LocalSettingsSchema.parse({
        browser_cache_bytes: 8 * 1024 * 1024 * 1024 + 1,
      }),
    ).toThrow();
  });
});

describe("redaction and stable errors", () => {
  it("redacts bearer, bl_ keys, proxy credentials, lease tokens, URLs, and nested causes", () => {
    const text =
      "Bearer bl_id_secret password=proxy-pass lease_token=lease-secret https://example.test/x";
    expect(redactString(text)).not.toMatch(
      /bl_id_secret|proxy-pass|lease-secret|https:\/\/example/,
    );
    const error = new Error(text, {
      cause: new Error("api_key=bl_nested_secret"),
    });
    const serialized = serializeError(error);
    expect(JSON.stringify(serialized)).not.toMatch(
      /bl_|proxy-pass|lease-secret|https:\/\//,
    );
    expect(redact({ proxy_password: "secret", nested: [text] })).toEqual({
      proxy_password: "<redacted>",
      nested: [expect.any(String)],
    });
    expect(safeErrorMessage(new Error("\u0001"))).toBe(
      "Lifecycle request could not be completed.",
    );
  });

  it("exposes stable hierarchy and all keychain codes", () => {
    expect(new ConflictError().code).toBe("CONFLICT");
    expect(new PreconditionError().status).toBe(412);
    expect(new KeychainError("NOT_FOUND").keychain_code).toBe("NOT_FOUND");
    expect(new KeychainError("BACKEND_UNAVAILABLE").keychain_code).toBe(
      "BACKEND_UNAVAILABLE",
    );
    expect(new KeychainError("LOCKED").keychain_code).toBe("LOCKED");
    expect(new KeychainError("DENIED").keychain_code).toBe("DENIED");
    expect(new KeychainError("TIMEOUT").keychain_code).toBe("TIMEOUT");
  });
});
