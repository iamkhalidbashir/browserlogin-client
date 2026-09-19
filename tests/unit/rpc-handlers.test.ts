import { describe, expect, test, vi } from "vitest";
import {
  AppRPCSchemas,
  type AppRPCMethod,
  parseRpcReply,
} from "../../src/shared/rpc-schema.js";
import {
  createRPCHandlers,
  defineAppRPC,
  throttleProgress,
} from "../../src/bun/rpc.js";

const electrobunMock = vi.hoisted(() => ({
  defineRPC: vi.fn(),
}));

vi.mock("electrobun/main", () => ({ BrowserView: electrobunMock }));

const validParams: Record<AppRPCMethod, unknown> = {
  connectionGet: {},
  connectionSet: {
    appOrigin: "https://example.test",
    apiKey: "bl_test_key",
  },
  connectionTest: {},
  connectionClear: {},
  profilesList: {},
  profilesGet: { profileId: "profile-1" },
  profilesCreate: { name: "test" },
  profilesUpdate: { profileId: "profile-1", expectedConfigVersion: 1 },
  profilesDelete: { profileId: "profile-1" },
  profilesRestore: { profileId: "profile-1" },
  sessionsStart: { profileId: "profile-1" },
  sessionsStop: { profileId: "profile-1" },
  sessionsForceStop: { profileId: "profile-1", confirmation: "FORCE CLOSE" },
  sessionsLive: {},
  sessionsTransferProgress: {},
  proxiesList: {},
  proxiesCreate: {
    name: "proxy",
    protocol: "http",
    host: "127.0.0.1",
    port: 8080,
  },
  proxiesUpdate: {
    proxyId: "proxy-1",
    name: "proxy",
    protocol: "http",
    host: "127.0.0.1",
    port: 8080,
  },
  proxiesDelete: { proxyId: "proxy-1" },
  proxiesChangeIp: { proxyId: "proxy-1" },
  currentUser: {},
  usersList: {},
  usersDisable: { userId: "user-1" },
  membersList: { profileId: "profile-1" },
  membersShare: { profileId: "profile-1", userId: "user-1", role: "viewer" },
  membersRemove: { profileId: "profile-1", userId: "user-1" },
  notesGet: { profileId: "profile-1" },
  notesAppend: { profileId: "profile-1", notes: "note", expectedVersion: 0 },
  notesReplace: { profileId: "profile-1", notes: "note", expectedVersion: 0 },
  notesHistory: { profileId: "profile-1" },
  auditList: {},
  binaryStatus: {},
  binaryDownload: { advancedEnabled: false },
  binaryProgress: {},
  licenseStatus: {},
  licenseSet: { licenseKey: "license" },
  licenseClear: {},
  settingsGet: {},
  settingsSet: { advancedEnabled: false },
  updatesCheck: {},
  updatesDownload: {},
  updatesApply: { confirmed: true },
  logsTail: { lines: 500 },
};

describe("application RPC contract", () => {
  test("accepts optional camel-case human-attention setting updates", () => {
    expect(
      AppRPCSchemas.settingsSet.params.parse({
        attentionEnabled: true,
        attentionDelivery: "audio",
        attentionSound: "subtle",
      }),
    ).toEqual({
      attentionEnabled: true,
      attentionDelivery: "audio",
      attentionSound: "subtle",
    });
    expect(
      AppRPCSchemas.settingsSet.params.parse({ attentionEnabled: false }),
    ).toEqual({ attentionEnabled: false });
  });

  test("rejects invalid or unknown human-attention setting updates", () => {
    expect(() =>
      AppRPCSchemas.settingsSet.params.parse({
        attentionDelivery: "desktop",
      }),
    ).toThrow();
    expect(() =>
      AppRPCSchemas.settingsSet.params.parse({ attentionSound: "chime" }),
    ).toThrow();
    expect(() =>
      AppRPCSchemas.settingsSet.params.parse({
        attentionEnabled: true,
        attentionMode: "both",
      }),
    ).toThrow();
  });

  test("types cached and refreshed update checks", () => {
    expect(AppRPCSchemas.updatesCheck.params.parse({})).toEqual({});
    expect(AppRPCSchemas.updatesCheck.params.parse({ mode: "latest" })).toEqual(
      { mode: "latest" },
    );
    expect(
      AppRPCSchemas.updatesCheck.params.parse({ mode: "refresh" }),
    ).toEqual({ mode: "refresh" });
    expect(() =>
      AppRPCSchemas.updatesCheck.params.parse({ mode: "production" }),
    ).toThrow();
    expect(AppRPCSchemas.updatesCheck.result.parse(null)).toBeNull();
  });

  test("registers every RPC method as an object handler", async () => {
    electrobunMock.defineRPC.mockReturnValue({
      send: {
        binaryProgress: vi.fn(),
        updateStatus: vi.fn(),
      },
    });

    await defineAppRPC({ services: {} });

    expect(electrobunMock.defineRPC).toHaveBeenCalledWith({
      maxRequestTime: 30_000,
      handlers: {
        requests: Object.fromEntries(
          Object.keys(AppRPCSchemas).map((method) => [
            method,
            expect.any(Function),
          ]),
        ),
      },
    });
  });

  test("maps every declared operation to its core service", async () => {
    const calls = new Set<string>();
    const services = Object.fromEntries(
      (Object.keys(AppRPCSchemas) as AppRPCMethod[]).map((name) => [
        name,
        async () => {
          calls.add(name);
          return { operation: name };
        },
      ]),
    );
    const handlers = createRPCHandlers({ services });
    for (const name of Object.keys(AppRPCSchemas) as AppRPCMethod[]) {
      const result = await handlers[name](validParams[name]);
      expect(typeof parseRpcReply(result).ok).toBe("boolean");
      expect(calls.has(name)).toBe(true);
    }
    expect(calls.size).toBeGreaterThanOrEqual(25);
    expect(calls.size).toBe(Object.keys(AppRPCSchemas).length);
  });

  test("validates responses and strips proxy passwords before renderer delivery", async () => {
    const handlers = createRPCHandlers({
      services: {
        proxiesList: async () => [
          {
            id: "proxy-1",
            name: "proxy",
            protocol: "http",
            host: "127.0.0.1",
            port: 8080,
            username: "user",
            password: "must-not-render",
          },
        ],
      },
    });
    const result = await handlers.proxiesList({});
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("must-not-render");
  });

  test("returns a typed error for malformed input and remains callable", async () => {
    const handler = createRPCHandlers({ services: {} }).profilesGet;
    const first = await handler({ profileId: "" });
    const second = await handler({ profileId: "profile-1", extra: true });
    expect(first).toMatchObject({ ok: false, error: { code: "RPC_ERROR" } });
    expect(second).toMatchObject({ ok: false, error: { code: "RPC_ERROR" } });
    expect(await handler({ profileId: "profile-1" })).toEqual({
      ok: false,
      error: {
        code: "NOT_IMPLEMENTED",
        message: "profilesGet is not configured",
      },
    });
  });

  test("returns all session transfer progress through one generated handler", async () => {
    // Given
    const snapshots = [
      {
        profileId: "profile-download",
        direction: "download",
        transferred: 40,
        total: 100,
        percentage: 40,
        status: "running",
      },
      {
        profileId: "profile-upload",
        direction: "upload",
        transferred: 65,
        total: 100,
        percentage: 65,
        status: "failed",
      },
    ] as const;
    const service = vi.fn(async () => snapshots);
    const handler = createRPCHandlers({
      services: { sessionsTransferProgress: service },
    }).sessionsTransferProgress;

    // When
    const result = await handler({});

    // Then
    expect(result).toEqual({ ok: true, value: snapshots });
    expect(service).toHaveBeenCalledOnce();
    expect(service).toHaveBeenCalledWith({});
  });

  test("rejects malformed session transfer requests and service responses", async () => {
    // Given
    const malformedSnapshots = [
      {
        profileId: "",
        direction: "download",
        transferred: 0,
        total: 1,
        percentage: 0,
        status: "running",
      },
      {
        profileId: "profile-1",
        direction: "sideways",
        transferred: 0,
        total: 1,
        percentage: 0,
        status: "running",
      },
      {
        profileId: "profile-1",
        direction: "download",
        transferred: -1,
        total: 1,
        percentage: 0,
        status: "running",
      },
      {
        profileId: "profile-1",
        direction: "download",
        transferred: 0.5,
        total: 1,
        percentage: 0,
        status: "running",
      },
      {
        profileId: "profile-1",
        direction: "download",
        transferred: 0,
        total: Number.MAX_SAFE_INTEGER + 1,
        percentage: 0,
        status: "running",
      },
      {
        profileId: "profile-1",
        direction: "download",
        transferred: 0,
        total: 1,
        percentage: 101,
        status: "running",
      },
      {
        profileId: "profile-1",
        direction: "download",
        transferred: 0,
        total: 1,
        percentage: 0.5,
        status: "running",
      },
      {
        profileId: "profile-1",
        direction: "download",
        transferred: 0,
        total: 1,
        percentage: 0,
        status: "paused",
      },
    ];

    // When / Then
    expect(() =>
      AppRPCSchemas.sessionsTransferProgress.params.parse({ extra: true }),
    ).toThrow();
    for (const snapshot of malformedSnapshots) {
      const handler = createRPCHandlers({
        services: { sessionsTransferProgress: async () => [snapshot] },
      }).sessionsTransferProgress;
      await expect(handler({})).resolves.toMatchObject({
        ok: false,
        error: { code: "RPC_ERROR" },
      });
    }
  });

  test("preserves the binary progress request and result contract", () => {
    // Given / When
    const params = AppRPCSchemas.binaryProgress.params.parse({});
    const result = AppRPCSchemas.binaryProgress.result.parse({
      downloaded: 25,
      total: 100,
      done: false,
    });

    // Then
    expect(params).toEqual({});
    expect(result).toEqual({ downloaded: 25, total: 100, done: false });
    expect(() =>
      AppRPCSchemas.binaryProgress.params.parse({ extra: true }),
    ).toThrow();
  });

  test("throttles binary progress to four messages per second", () => {
    vi.useFakeTimers();
    const messages: unknown[] = [];
    const emit = throttleProgress((value) => messages.push(value));
    emit({ downloaded: 1, total: 10, done: false });
    emit({ downloaded: 2, total: 10, done: false });
    emit({ downloaded: 3, total: 10, done: false });
    expect(messages).toHaveLength(1);
    vi.advanceTimersByTime(250);
    expect(messages).toHaveLength(2);
    emit({ downloaded: 10, total: 10, done: true });
    expect(messages).toHaveLength(3);
    vi.useRealTimers();
  });
});
