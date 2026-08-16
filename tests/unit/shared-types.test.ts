import { describe, expect, it } from "vitest";
import responses from "../fixtures/rest/responses.json";
import connection from "../fixtures/connection/schema.json";
import { z } from "zod";
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
import {
  KEYCHAIN_ACCOUNT_API_KEY,
  KEYCHAIN_ACCOUNT_LICENSE_KEY,
  KEYCHAIN_API_ACCOUNT,
  KEYCHAIN_LICENSE_ACCOUNT,
  KEYCHAIN_SERVICE,
} from "../../src/shared/keychain-types";

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
const documentedUser = {
  id: "user-owner",
  name: "Workspace Owner",
  email: "owner@example.com",
  status: "active",
  owner: true,
  created_at: "2026-08-11T12:00:00.000Z",
  updated_at: "2026-08-11T12:00:00.000Z",
};
const documentedNote = {
  id: "note-version-1",
  version: 2,
  notes: "Current notes",
  created_by: "user-owner",
  created_at: "2026-08-11T12:00:00.000Z",
};
const documentedMember = {
  id: "user-editor",
  name: "Editor",
  email: "editor@example.com",
  status: "active",
  role: "editor",
  created_at: "2026-08-11T12:00:00.000Z",
  updated_at: "2026-08-11T12:00:00.000Z",
};
const documentedApiKey = {
  id: "api-key-1",
  name: "Automation client",
  prefix: "bl_key-id",
  status: "active",
  expires_at: null,
  last_used_at: "2026-08-11T12:00:00.000Z",
  revoked_at: null,
  created_at: "2026-08-11T11:00:00.000Z",
};
const documentedAudit = {
  action: "profile.updated",
  entity_type: "browserProfile",
  entity_id: "profile-1",
  actor_user_id: "user-owner",
  created_at: "2026-08-11T12:00:00.000Z",
};

describe("shared API contracts", () => {
  it("parses 25 genuine labeled docs and fixture examples", () => {
    const examples = [
      ["fixture profile", ProfileSchema, responses.profile],
      ["fixture start profile", ProfileSchema, profile],
      ["fixture session", SessionSchema, session],
      ["fixture archive", ArchiveIdentitySchema, archive],
      ["fixture stop", SessionSchema, responses.stop],
      ["fixture force stop", SessionSchema, responses.forceStop],
      [
        "docs user",
        UserSchema,
        {
          id: "user-owner",
          name: "Workspace Owner",
          email: "owner@example.com",
          status: "active",
          owner: true,
          created_at: "2026-08-11T12:00:00.000Z",
          updated_at: "2026-08-11T12:00:00.000Z",
        },
      ],
      [
        "docs member",
        MemberSchema,
        {
          id: "user-editor",
          name: "Editor",
          email: "editor@example.com",
          status: "active",
          role: "editor",
          created_at: "2026-08-11T12:00:00.000Z",
          updated_at: "2026-08-11T12:00:00.000Z",
        },
      ],
      [
        "docs notes",
        z.object({ notes: z.string(), version: z.number().int() }),
        { notes: "Current notes", version: 2 },
      ],
      [
        "docs note history",
        NoteVersionSchema,
        {
          id: "note-version-1",
          version: 2,
          notes: "Current notes",
          created_by: "user-owner",
          created_at: "2026-08-11T12:00:00.000Z",
        },
      ],
      [
        "docs start with archive",
        StartResponseSchema,
        { session, profile, archive },
      ],
      [
        "docs start without archive",
        StartResponseSchema,
        { session, profile, archive: null },
      ],
      [
        "docs stored archive",
        ArchiveIdentitySchema,
        {
          ...archive,
          download_url: "/api/v1/profiles/profile-1/archive/download",
          created_at: "2026-08-11T12:00:00.000Z",
        },
      ],
      ["docs proxy list", ProxySchema, proxy],
      [
        "docs proxy change IP",
        z.object({ id: z.string(), ip: z.string(), changed_at: z.string() }),
        {
          id: "proxy-1",
          ip: "203.0.113.42",
          changed_at: "2026-08-11T12:00:00.000Z",
        },
      ],
      [
        "docs API key metadata",
        ApiKeyMetadataSchema,
        {
          id: "api-key-1",
          name: "Automation client",
          prefix: "bl_key-id",
          status: "active",
          expires_at: null,
          last_used_at: "2026-08-11T12:00:00.000Z",
          revoked_at: null,
          created_at: "2026-08-11T11:00:00.000Z",
        },
      ],
      [
        "docs workspace user",
        UserSchema,
        {
          id: "user-editor",
          name: "Editor",
          email: "editor@example.com",
          status: "active",
          owner: false,
        },
      ],
      [
        "docs audit event",
        AuditEventSchema,
        {
          action: "profile.updated",
          entity_type: "browserProfile",
          entity_id: "profile-1",
          actor_user_id: "user-owner",
          created_at: "2026-08-11T12:00:00.000Z",
        },
      ],
      [
        "docs upload URL",
        z.object({
          upload_url: z.string(),
          expires_at: z.string(),
          session_id: z.string(),
        }),
        {
          upload_url: "https://storage.example/upload",
          expires_at: "2026-08-11T12:15:00.000Z",
          session_id: "session-1",
        },
      ],
      [
        "docs stopped session",
        SessionSchema,
        {
          id: "session-1",
          profile_id: "profile-1",
          generation: 1,
          state: "stopped",
          started_at: "2026-08-11T12:00:00.000Z",
          heartbeat_at: null,
          expires_at: null,
          force_stopped_at: null,
          stopped_at: "2026-08-11T12:05:00.000Z",
          status: "stopped",
          archive_generation: 4,
        },
      ],
      [
        "docs SOCKS5 proxy",
        ProxySchema,
        { ...proxy, protocol: "socks5", port: 1080 },
      ],
      [
        "docs careful profile",
        ProfileSchema,
        { ...profile, human_preset: "careful" },
      ],
      [
        "docs natural profile",
        ProfileSchema,
        { ...profile, bumblebee_profile: "natural" },
      ],
      [
        "docs null credentials",
        ProxySchema,
        { ...proxy, username: null, password: null },
      ],
      [
        "docs cloud session",
        ProfileSchema,
        {
          ...profile,
          cloud: { ...profile.cloud, current_session_id: "session-1" },
        },
      ],
      [
        "docs archive URL",
        ArchiveIdentitySchema,
        {
          ...archive,
          download_url: "/api/v1/profiles/profile-1/archive/download",
        },
      ],
    ] as const;
    for (const [label, schema, value] of examples) {
      expect(() => schema.parse(value), label).not.toThrow();
    }
    expect(examples).toHaveLength(26);
    expect(examples.map(([label]) => label)).toContain("docs audit event");
  });

  it("preserves unknown response fields", () => {
    const parsed = ProfileSchema.parse({
      ...profile,
      future_field: { enabled: true },
    });
    expect(parsed.future_field).toEqual({ enabled: true });
  });

  it("preserves unknown fields on every listed response schema", () => {
    const extra = { future_field: { enabled: true } };
    expect(
      UserSchema.parse({ ...documentedUser, ...extra }).future_field,
    ).toEqual(extra.future_field);
    expect(ProxySchema.parse({ ...proxy, ...extra }).future_field).toEqual(
      extra.future_field,
    );
    expect(ProfileSchema.parse({ ...profile, ...extra }).future_field).toEqual(
      extra.future_field,
    );
    expect(SessionSchema.parse({ ...session, ...extra }).future_field).toEqual(
      extra.future_field,
    );
    expect(
      ArchiveIdentitySchema.parse({ ...archive, ...extra }).future_field,
    ).toEqual(extra.future_field);
    expect(
      StartResponseSchema.parse({ session, profile, archive, ...extra })
        .future_field,
    ).toEqual(extra.future_field);
    expect(
      NoteVersionSchema.parse({ ...documentedNote, ...extra }).future_field,
    ).toEqual(extra.future_field);
    expect(
      MemberSchema.parse({ ...documentedMember, ...extra }).future_field,
    ).toEqual(extra.future_field);
    expect(
      ApiKeyMetadataSchema.parse({ ...documentedApiKey, ...extra })
        .future_field,
    ).toEqual(extra.future_field);
    expect(
      AuditEventSchema.parse({ ...documentedAudit, ...extra }).future_field,
    ).toEqual(extra.future_field);
  });

  it("rejects unsupported documented enum values", () => {
    expect(() => ProxySchema.parse({ ...proxy, protocol: "https" })).toThrow();
    expect(() =>
      ProfileSchema.parse({ ...profile, human_preset: "balanced" }),
    ).toThrow();
    expect(() =>
      ProfileSchema.parse({ ...profile, bumblebee_profile: "invented" }),
    ).toThrow();
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
      browser_cache_max_bytes: 512 * 1024 * 1024,
      update_channel: "stable",
    });
    expect(() =>
      LocalSettingsSchema.parse({ download_source: "custom" }),
    ).toThrow();
    expect(() =>
      LocalSettingsSchema.parse({
        browser_cache_max_bytes: 8 * 1024 * 1024 * 1024 + 1,
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
    expect(new KeychainError("NOT_FOUND").code).toBe("NOT_FOUND");
    expect(new KeychainError("BACKEND_UNAVAILABLE").code).toBe(
      "BACKEND_UNAVAILABLE",
    );
    expect(new KeychainError("LOCKED").code).toBe("LOCKED");
    expect(new KeychainError("DENIED").code).toBe("DENIED");
    expect(new KeychainError("TIMEOUT").code).toBe("TIMEOUT");
    expect(KEYCHAIN_SERVICE).toBe("co.browserlogin.app");
    expect(KEYCHAIN_API_ACCOUNT).toBe("browserlogin-api-key");
    expect(KEYCHAIN_LICENSE_ACCOUNT).toBe("cloakbrowser-license-key");
    expect(KEYCHAIN_ACCOUNT_API_KEY).toBe(KEYCHAIN_API_ACCOUNT);
    expect(KEYCHAIN_ACCOUNT_LICENSE_KEY).toBe(KEYCHAIN_LICENSE_ACCOUNT);
  });
});
