import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BrowserLoginClient,
  type FetchLike,
} from "../../src/core/api/client.js";
import {
  ApiError,
  ArchiveError,
  ConflictError,
  PreconditionError,
} from "../../src/shared/errors.js";
import requestFixture from "../fixtures/rest/requests.json";
import { startBrowserLoginMock } from "../mocks/browserlogin-server.js";

const key = "bl_test_key_secret";
const sha256 =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const identity = {
  profile_id: "profile-1",
  generation: 4,
  size: 4,
  sha256,
  format: "zip" as const,
};
const closers: Array<() => Promise<void>> = [];
const endpointCases = [
  "getUser",
  "getMe",
  "getOwner",
  "listProfiles",
  "getProfile",
  "createProfile",
  "updateProfile",
  "deleteProfile",
  "restoreProfile",
  "listMembers",
  "shareProfile",
  "removeMember",
  "getNotes",
  "appendNotes",
  "replaceNotes",
  "listNoteHistory",
  "listNotesHistory",
  "startSession",
  "getArchive",
  "downloadArchive",
  "requestUploadUrl",
  "getSession",
  "sessionStatus",
  "stopSession",
  "forceStopSession",
  "normalStopWithoutArchive",
  "listProxies",
  "createProxy",
  "updateProxy",
  "deleteProxy",
  "changeProxyIp",
  "listUsers",
  "disableUser",
  "listAudit",
] as const;

afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

function client(
  baseUrl: string,
  overrides: Partial<ConstructorParameters<typeof BrowserLoginClient>[0]> = {},
): BrowserLoginClient {
  return new BrowserLoginClient({
    baseUrl,
    credentials: async () => key,
    ...overrides,
  });
}

describe("BrowserLogin REST client", () => {
  it("sweeps the Task 2 local REST surface and keeps request parity", async () => {
    const server = await startBrowserLoginMock();
    closers.push(server.close);
    const seen: Array<{
      method: string;
      path: string;
      headers: Headers;
      body: string;
    }> = [];
    const fetcher: FetchLike = async (input, init) => {
      const request = new Request(input, init);
      seen.push({
        method: request.method,
        path: new URL(request.url).pathname + new URL(request.url).search,
        headers: request.headers,
        body: await request.clone().text(),
      });
      return fetch(request);
    };
    const api = client(`${server.url}/api/v1`, {
      fetch: fetcher,
      now: () => Date.parse("2026-08-16T00:00:00.000Z"),
    });

    expect((await api.getUser()).id).toBe("user-1");
    expect((await api.getMe()).owner).toBe(true);
    expect((await api.getOwner()).email).toBe("owner@example.test");
    expect((await api.listProfiles())[0]?.id).toBe("profile-1");
    expect((await api.getProfile("profile-1")).id).toBe("profile-1");
    expect((await api.createProfile({ name: "Research" }, "create-1")).id).toBe(
      "profile-1",
    );
    expect(
      (
        await api.updateProfile("profile-1", {
          expected_config_version: 1,
          name: "Research",
        })
      ).id,
    ).toBe("profile-1");
    expect((await api.deleteProfile("profile-1")).status).toBe("deleted");
    expect((await api.restoreProfile("profile-1")).status).toBe("restored");
    await expect(api.listMembers("profile-1")).rejects.toBeInstanceOf(ApiError);
    expect(
      (await api.shareProfile("profile-1", "user-2", "editor")).status,
    ).toBe("shared");
    expect((await api.removeMember("profile-1", "user-2")).status).toBe(
      "removed",
    );
    expect((await api.getNotes("profile-1")).version).toBe(2);
    expect((await api.appendNotes("profile-1", "New", 2)).version).toBe(3);
    expect(
      (await api.replaceNotes("profile-1", "Replacement", 2)).version,
    ).toBe(3);
    await expect(api.listNoteHistory("profile-1")).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(api.listNotesHistory("profile-1")).rejects.toBeInstanceOf(
      ApiError,
    );
    expect((await api.startSession("profile-1", "start-1")).session.id).toBe(
      "session-1",
    );
    expect((await api.getArchive("profile-1")).archive?.generation).toBe(4);
    expect(
      (await api.requestUploadUrl("profile-1", "session-1")).session_id,
    ).toBe("session-1");
    expect((await api.getSession("session-1")).state).toBe("active");
    expect((await api.sessionStatus("session-1")).state).toBe("active");
    expect(
      (
        await api.stopSession(
          "session-1",
          { storage_id: "storage-1", size: 4, sha256, format: "zip" },
          "stop-1",
        )
      ).state,
    ).toBe("stopped");
    expect((await api.forceStopSession("session-1", "force-1")).status).toBe(
      "stopped",
    );
    expect(
      (await api.normalStopWithoutArchive("session-1", "rollback-1")).status,
    ).toBe("stopped");
    await expect(
      api.downloadArchive(
        identity,
        join(tmpdir(), "browserlogin-mock-tamper.zip"),
      ),
    ).rejects.toBeInstanceOf(PreconditionError);
    expect((await api.listProxies())[0]?.id).toBe("proxy-1");
    expect(
      (
        await api.createProxy(
          { name: "Proxy", protocol: "http", host: "proxy.test", port: 8080 },
          "proxy-1",
        )
      ).id,
    ).toBe("proxy-1");
    expect(
      (
        await api.updateProxy("proxy-1", {
          name: "Proxy",
          protocol: "http",
          host: "proxy.test",
          port: 8080,
        })
      ).id,
    ).toBe("proxy-1");
    expect((await api.deleteProxy("proxy-1")).status).toBe("deleted");
    expect((await api.changeProxyIp("proxy-1")).ip).toBe("203.0.113.42");
    await expect(api.listUsers()).rejects.toBeInstanceOf(ApiError);
    expect((await api.disableUser("user-2")).status).toBe("disabled");
    await expect(api.listAudit("profile-1")).rejects.toBeInstanceOf(ApiError);

    const start = seen.find((request) =>
      request.path.endsWith("/profiles/profile-1/sessions"),
    );
    expect(start).toMatchObject({ method: "POST", body: "{}" });
    expect(start?.headers.get("authorization")).toBe(`Bearer ${key}`);
    expect(start?.headers.get("idempotency-key")).toBe("start-1");
    expect(seen.some((request) => request.path.includes("/api-keys"))).toBe(
      false,
    );
    expect(
      seen.filter((request) => request.method === "GET").length,
    ).toBeGreaterThan(10);
    for (const expected of requestFixture.requests.filter(
      ({ name }) => name !== "directUpload",
    )) {
      const match = seen.find(
        (request) =>
          request.method === expected.method &&
          request.path === `/api/v1${expected.path}` &&
          (expected.body === undefined ||
            request.body === JSON.stringify(expected.body)),
      );
      expect(match, expected.name).toBeDefined();
      for (const [header, value] of Object.entries(expected.headers))
        expect(match?.headers.get(header), `${expected.name} ${header}`).toBe(
          value,
        );
    }
  });

  it.each(endpointCases)("endpoint case: %s", async (operation) => {
    const server = await startBrowserLoginMock();
    try {
      const api = client(`${server.url}/api/v1`, {
        now: () => Date.parse("2026-08-16T00:00:00.000Z"),
      });
      switch (operation) {
        case "getUser":
          await api.getUser();
          break;
        case "getMe":
          await api.getMe();
          break;
        case "getOwner":
          await api.getOwner();
          break;
        case "listProfiles":
          await api.listProfiles();
          break;
        case "getProfile":
          await api.getProfile("profile-1");
          break;
        case "createProfile":
          await api.createProfile({ name: "Research" }, "case-create");
          break;
        case "updateProfile":
          await api.updateProfile("profile-1", {
            expected_config_version: 1,
            name: "Research",
          });
          break;
        case "deleteProfile":
          await api.deleteProfile("profile-1");
          break;
        case "restoreProfile":
          await api.restoreProfile("profile-1");
          break;
        case "listMembers":
          await expect(api.listMembers("profile-1")).rejects.toBeInstanceOf(
            ApiError,
          );
          break;
        case "shareProfile":
          await api.shareProfile("profile-1", "user-2", "editor");
          break;
        case "removeMember":
          await api.removeMember("profile-1", "user-2");
          break;
        case "getNotes":
          await api.getNotes("profile-1");
          break;
        case "appendNotes":
          await api.appendNotes("profile-1", "New", 2);
          break;
        case "replaceNotes":
          await api.replaceNotes("profile-1", "Replacement", 2);
          break;
        case "listNoteHistory":
          await expect(api.listNoteHistory("profile-1")).rejects.toBeInstanceOf(
            ApiError,
          );
          break;
        case "listNotesHistory":
          await expect(
            api.listNotesHistory("profile-1"),
          ).rejects.toBeInstanceOf(ApiError);
          break;
        case "startSession":
          await api.startSession("profile-1", "case-start");
          break;
        case "getArchive":
          await api.getArchive("profile-1");
          break;
        case "downloadArchive":
          await expect(
            api.downloadArchive(
              identity,
              join(tmpdir(), `browserlogin-${operation}.zip`),
            ),
          ).rejects.toBeInstanceOf(PreconditionError);
          break;
        case "requestUploadUrl":
          await api.requestUploadUrl("profile-1", "session-1");
          break;
        case "getSession":
          await api.getSession("session-1");
          break;
        case "sessionStatus":
          await api.sessionStatus("session-1");
          break;
        case "stopSession":
          await api.stopSession("session-1", undefined, "case-stop");
          break;
        case "forceStopSession":
          await api.forceStopSession("session-1", "case-force");
          break;
        case "normalStopWithoutArchive":
          await api.normalStopWithoutArchive("session-1", "case-normal");
          break;
        case "listProxies":
          await api.listProxies();
          break;
        case "createProxy":
          await api.createProxy(
            { name: "Proxy", protocol: "http", host: "proxy.test", port: 8080 },
            "case-proxy",
          );
          break;
        case "updateProxy":
          await api.updateProxy("proxy-1", {
            name: "Proxy",
            protocol: "http",
            host: "proxy.test",
            port: 8080,
          });
          break;
        case "deleteProxy":
          await api.deleteProxy("proxy-1");
          break;
        case "changeProxyIp":
          await api.changeProxyIp("proxy-1");
          break;
        case "listUsers":
          await expect(api.listUsers()).rejects.toBeInstanceOf(ApiError);
          break;
        case "disableUser":
          await api.disableUser("user-2");
          break;
        case "listAudit":
          await expect(api.listAudit("profile-1")).rejects.toBeInstanceOf(
            ApiError,
          );
          break;
      }
    } finally {
      await server.close();
    }
  });

  it("streams, validates, and atomically activates an archive", async () => {
    const server = await startBrowserLoginMock();
    closers.push(server.close);
    const directory = await mkdtemp(join(tmpdir(), "browserlogin-archive-"));
    closers.push(() => rm(directory, { recursive: true, force: true }));
    const destination = join(directory, "profile.zip");
    const archiveHash = createHash("sha256").update("DATA").digest("hex");
    const api = client(`${server.url}/api/v1`, {
      fetch: async (_input, init) => {
        expect(init?.headers).toBeDefined();
        return new Response("DATA", {
          status: 200,
          headers: {
            "Content-Type": "application/zip",
            "Content-Length": "4",
            ETag: `"${archiveHash}"`,
            "X-Archive-Generation": "4",
            Digest: `sha-256=${Buffer.from(archiveHash, "hex").toString("base64")}`,
          },
        });
      },
    });
    await api.downloadArchive(
      { ...identity, sha256: archiveHash },
      destination,
    );
    expect(await readFile(destination, "utf8")).toBe("DATA");

    const tampered = join(directory, "tampered.zip");
    await expect(
      client(`${server.url}/api/v1`).downloadArchive(identity, tampered),
    ).rejects.toBeInstanceOf(PreconditionError);
    await expect(readFile(tampered)).rejects.toThrow();
    await expect(
      client(`${server.url}/api/v1`).downloadArchive(
        { ...identity, generation: 3 },
        join(directory, "generation-mismatch.zip"),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("validates upload grants, sends exact bytes, and never leaks bearer auth", async () => {
    const payloadPath = join(
      await mkdtemp(join(tmpdir(), "browserlogin-upload-")),
      "archive.zip",
    );
    closers.push(() => rm(payloadPath, { recursive: true, force: true }));
    await writeFile(payloadPath, Buffer.from("DATA"));
    let uploadRequest: Request | undefined;
    const fetcher: FetchLike = async (input, init) => {
      uploadRequest = new Request(input, init);
      return new Response(JSON.stringify({ storageId: "storage-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const api = client("https://browserlogin.test/api/v1", {
      fetch: fetcher,
      now: () => Date.parse("2026-08-16T00:00:00.000Z"),
    });
    const grant = {
      upload_url: "https://browserlogin.test/upload/test-upload",
      expires_at: "2026-08-16T01:00:00.000Z",
      session_id: "session-1",
    };
    expect(
      await api.directUpload(grant, payloadPath, {
        expectedSize: 4,
        expectedSha256: createHash("sha256").update("DATA").digest("hex"),
        expectedSessionId: "session-1",
      }),
    ).toBe("storage-1");
    expect(uploadRequest?.headers.get("authorization")).toBeNull();
    expect(uploadRequest?.headers.get("content-type")).toBe("application/zip");
    expect(await uploadRequest?.text()).toBe("DATA");
    const expectedUpload = requestFixture.requests.find(
      ({ name }) => name === "directUpload",
    );
    expect(new URL(uploadRequest!.url).pathname).toBe(expectedUpload?.path);
    for (const [header, value] of Object.entries(expectedUpload?.headers ?? {}))
      expect(uploadRequest?.headers.get(header)).toBe(value);
    await expect(
      api.directUpload(
        {
          ...grant,
          upload_url: "https://user:pass@convex-storage.test/upload",
        },
        payloadPath,
        { expectedSessionId: "session-1" },
      ),
    ).rejects.toBeInstanceOf(ArchiveError);
    await expect(
      api.directUpload(
        { ...grant, expires_at: "2020-01-01T00:00:00.000Z" },
        payloadPath,
        { expectedSessionId: "session-1" },
      ),
    ).rejects.toBeInstanceOf(ArchiveError);
    await expect(
      api.directUpload({ ...grant, expires_at: "not-a-date" }, payloadPath, {
        expectedSessionId: "session-1",
      }),
    ).rejects.toBeInstanceOf(ArchiveError);
    await expect(
      api.directUpload(grant, payloadPath, {
        expectedSessionId: "other-session",
      }),
    ).rejects.toBeInstanceOf(ArchiveError);

    const stalled = client("https://browserlogin.test/api/v1", {
      fetch: async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
      timeoutMs: 1,
    });
    await expect(
      stalled.directUpload(grant, payloadPath, {
        expectedSessionId: "session-1",
      }),
    ).rejects.toBeDefined();
  });

  it("enforces base URL, body cap, idempotency, retry, timeout, and status policies", async () => {
    expect(() => client("http://example.test/api/v1")).toThrow();
    const calls: Request[] = [];
    const fetcher: FetchLike = async (input, init) => {
      const request = new Request(input, init);
      calls.push(request);
      if (request.method === "GET" && calls.length < 3)
        return new Response("busy", { status: 503 });
      return new Response(
        JSON.stringify({
          id: "user-1",
          name: "Owner",
          email: "owner@test",
          status: "active",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const api = client("https://browserlogin.test/api/v1", {
      fetch: fetcher,
      sleep: async () => undefined,
      random: () => 0,
    });
    expect((await api.getUser()).id).toBe("user-1");
    expect(calls).toHaveLength(3);
    await expect(
      api.createProfile({ name: "x".repeat(300_000) }),
    ).rejects.toMatchObject({ status: 413 });
    expect(() => api.createProfile({ name: "ok" }, "")).toThrow();
    expect(calls.filter((request) => request.method === "POST")).toHaveLength(
      0,
    );

    const mutationCalls: Request[] = [];
    const noRetryMutation: FetchLike = async (input, init) => {
      mutationCalls.push(new Request(input, init));
      return new Response("busy", { status: 503 });
    };
    await expect(
      client("https://browserlogin.test/api/v1", {
        fetch: noRetryMutation,
      }).createProfile({ name: "one" }),
    ).rejects.toMatchObject({ status: 503 });
    expect(mutationCalls).toHaveLength(1);

    const timeoutFetch: FetchLike = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      });
    await expect(
      client("https://browserlogin.test/api/v1", {
        fetch: timeoutFetch,
        timeoutMs: 1,
      }).getUser(),
    ).rejects.toBeDefined();
  });

  it("maps archive generations and HTTP preconditions without retrying mutations", async () => {
    const fetcher: FetchLike = async (_input, init) =>
      new Response("", { status: init?.method === "POST" ? 409 : 412 });
    const api = client("https://browserlogin.test/api/v1", { fetch: fetcher });
    await expect(api.startSession("profile-1")).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      api.downloadArchive(identity, "/tmp/never-created.zip"),
    ).rejects.toBeInstanceOf(PreconditionError);
    const statusFetcher: FetchLike = async (_input, init) =>
      new Response("", { status: init?.method === "GET" ? 401 : 422 });
    const statusApi = client("https://browserlogin.test/api/v1", {
      fetch: statusFetcher,
    });
    await expect(statusApi.getUser()).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
    await expect(
      statusApi.createProfile({ name: "invalid" }),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_FAILED" });
    for (const [status, code] of [
      [429, "RATE_LIMITED"],
      [500, "UPSTREAM_ERROR"],
    ] as const) {
      const errorApi = client("https://browserlogin.test/api/v1", {
        fetch: async () => new Response("", { status }),
      });
      await expect(errorApi.getUser()).rejects.toMatchObject({ status, code });
    }
    const oversizedResponse = client("https://browserlogin.test/api/v1", {
      fetch: async () =>
        new Response(JSON.stringify({ data: "x".repeat(9 * 1024 * 1024) }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    await expect(oversizedResponse.getUser()).rejects.toMatchObject({
      status: 413,
    });
  });

  it("uses only the injected fetch, providing a no-DNS proof", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("DNS/global fetch used");
    }) as unknown as typeof fetch;
    try {
      const api = client("https://browserlogin.test/api/v1", {
        fetch: async () =>
          new Response(
            JSON.stringify({
              id: "user-1",
              name: "Owner",
              email: "owner@test",
              status: "active",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      });
      await expect(api.getUser()).resolves.toMatchObject({ id: "user-1" });
    } finally {
      globalThis.fetch = original;
    }
  });
});
