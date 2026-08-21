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
  cliInstall: {},
  logsTail: { lines: 500 },
};

describe("Task 25 RPC contract", () => {
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
