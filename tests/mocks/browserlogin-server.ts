import type { ServerResponse } from "node:http";
import { startServer, sendEmpty, sendJson, type MockRequest } from "./http.js";

const profileId = "profile-1";
const sessionId = "session-1";
const archiveBytes = Buffer.from("DATA");
const archiveSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const profile = { id: profileId, name: "Research profile", seed: 12345, platform: "macos", geoip: true, humanize: true, human_preset: "careful", bumblebee_profile: "natural", headless: false, timezone: null, locale: null, user_agent: null, viewport: null, args: ["--fingerprint-noise=false"], proxy: { id: "proxy-1", name: "Test proxy", protocol: "http", host: "proxy.test", port: 8080, username: "proxy-user", password: "TEST-ONLY-password", change_ip_url: "https://proxy.test/change-ip" }, cloud: { archive_generation: 4, current_session_id: null } };
const session = { id: sessionId, profile_id: profileId, generation: 1, state: "active" };

function auth(request: MockRequest, response: ServerResponse): boolean {
  const authorization = request.request.headers.authorization;
  if (authorization === "Bearer bl_test_key_secret") return true;
  sendJson(response, 401, { error: "unauthorized" }, { "WWW-Authenticate": 'Bearer realm="BrowserLogin"' });
  return false;
}

export async function startBrowserLoginMock() {
  return startServer(async ({ request, json }, response) => {
    if (!auth({ request, body: "", json }, response)) return;
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = request.method ?? "GET";
    if (request.headers["x-mock-status"] === "409") return sendJson(response, 409, { error: "conflict" });
    if (request.headers["x-mock-status"] === "412") return sendJson(response, 412, { error: "precondition" });
    if (request.headers["x-mock-status"] === "422") return sendJson(response, 422, { error: "invalid request" });
    if (method === "GET" && ["/user", "/me", "/owner"].includes(path)) return sendJson(response, 200, { id: "user-1", name: "Workspace Owner", email: "owner@example.test", status: "active", owner: true });
    if (method === "GET" && path === "/profiles") return sendJson(response, 200, [profile]);
    if (method === "POST" && path === "/profiles") return sendJson(response, 201, profile);
    if (path === `/profiles/${profileId}` && method === "GET") return sendJson(response, 200, profile);
    if (path === `/profiles/${profileId}` && method === "PATCH") return sendJson(response, 200, profile);
    if (path === `/profiles/${profileId}` && method === "DELETE") return sendJson(response, 200, { status: "deleted" });
    if (path === `/profiles/${profileId}/restore` && method === "POST") return sendJson(response, 200, { status: "restored" });
    if (path === `/profiles/${profileId}/members` && method === "GET") return sendJson(response, 200, [{ id: "user-2", name: "Editor", role: "editor" }]);
    if (path === `/profiles/${profileId}/members` && method === "POST") return sendJson(response, 200, { status: "shared" });
    if (path.startsWith(`/profiles/${profileId}/members/`) && method === "DELETE") return sendJson(response, 200, { status: "removed" });
    if (path === `/profiles/${profileId}/notes` && method === "GET") return sendJson(response, 200, { notes: "Current notes", version: 2 });
    if (path === `/profiles/${profileId}/notes` && ["POST", "PUT"].includes(method)) return sendJson(response, 200, { version: 3 });
    if (path === `/profiles/${profileId}/notes/history` && method === "GET") return sendJson(response, 200, [{ id: "note-1", version: 2, notes: "Current notes" }]);
    if (path === `/profiles/${profileId}/notes-history` && method === "GET") return sendJson(response, 200, [{ id: "note-1", version: 2, notes: "Current notes" }]);
    if (path === `/profiles/${profileId}/sessions` && method === "POST") return sendJson(response, 200, { session, profile, archive: { profile_id: profileId, generation: 4, size: archiveBytes.length, sha256: archiveSha256, format: "zip" } });
    if (path === `/profiles/${profileId}/archive` && method === "GET") return sendJson(response, 200, { archive: { profile_id: profileId, generation: 4, size: archiveBytes.length, sha256: archiveSha256, format: "zip", download_url: `/api/v1/profiles/${profileId}/archive/download` } });
    if (path === `/profiles/${profileId}/archive/download` && method === "GET") {
      if (url.searchParams.get("generation") !== "4") return sendJson(response, 409, { error: "archive generation conflict" });
      if (request.headers["if-match"] && request.headers["if-match"] !== `"${archiveSha256}"`) return sendJson(response, 412, { error: "archive precondition" });
      const digest = Buffer.from(archiveSha256, "hex").toString("base64");
      response.writeHead(200, { "Content-Type": "application/zip", "Content-Length": archiveBytes.length, ETag: `"${archiveSha256}"`, "X-Archive-Generation": "4", Digest: `sha-256=${digest}`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      return response.end(archiveBytes);
    }
    if (path === `/profiles/${profileId}/archive-upload-url` && method === "POST") return sendJson(response, 200, { upload_url: "https://convex-storage.test/api/storage/upload/session-1", expires_at: "2026-08-16T01:00:00.000Z", session_id: sessionId });
    if (path === `/sessions/${sessionId}` && method === "GET") return sendJson(response, 200, session);
    if (path === `/sessions/${sessionId}/status` && method === "GET") return sendJson(response, 200, session);
    if (path === `/sessions/${sessionId}/stop` && method === "POST") return sendJson(response, 200, json && "force" in json ? { ...session, state: "stopped", status: "stopped", force_stopped_at: "2026-08-16T00:00:00.000Z" } : { ...session, state: "stopped", status: "stopped", archive_generation: 5 });
    if (method === "GET" && path === "/proxies") return sendJson(response, 200, [profile.proxy]);
    if (method === "POST" && path === "/proxies") return sendJson(response, 201, profile.proxy);
    if (path === "/proxies/proxy-1" && method === "PATCH") return sendJson(response, 200, profile.proxy);
    if (path === "/proxies/proxy-1" && method === "DELETE") return sendJson(response, 200, { status: "deleted" });
    if (path === "/proxies/proxy-1/change-ip" && method === "POST") return sendJson(response, 200, { id: "proxy-1", ip: "203.0.113.42", changed_at: "2026-08-16T00:00:00.000Z" });
    if (method === "GET" && path === "/api-keys") return sendJson(response, 200, [{ id: "key-1", name: "Test key", prefix: "bl_test", status: "active" }]);
    if (method === "GET" && path === "/users") return sendJson(response, 200, [{ id: "user-2", name: "Editor", status: "active", owner: false }]);
    if (path === "/users/user-2/disable" && method === "POST") return sendJson(response, 200, { status: "disabled" });
    if (method === "GET" && path === "/audit") return sendJson(response, 200, [{ action: "profile.updated", entity_type: "browserProfile", entity_id: profileId }]);
    if (path === "/upload/test-upload" && method === "POST") return sendJson(response, 200, { storageId: "storage-1" });
    sendEmpty(response, 404);
  });
}
