import { createHash, createPublicKey, verify } from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";
import { startBrowserLoginMock } from "../mocks/browserlogin-server.js";
import { startDistributionMock, verifyTestOnlyChecksums } from "../mocks/distribution-server.js";
import { startRemoteMcpMock } from "../mocks/remote-mcp-server.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { while (closers.length) await closers.pop()?.(); });

describe("Task 2 local mock servers", () => {
  it("covers BrowserLogin REST success and named 401/409/412/422 paths", async () => {
    const server = await startBrowserLoginMock(); closers.push(server.close);
    const ok = await fetch(`${server.url}/api/v1/profiles`, { headers: { Authorization: "Bearer bl_test_key_secret" } });
    expect(ok.status).toBe(200);
    expect((await ok.json() as Array<{ id: string; name: string; platform: string }>)[0]).toMatchObject({ id: "profile-1", name: "Research profile", platform: "macos" });
    const startResponse = await fetch(`${server.url}/api/v1/profiles/profile-1/sessions`, { method: "POST", headers: { Authorization: "Bearer bl_test_key_secret", Accept: "application/json", "Content-Type": "application/json", "Idempotency-Key": "start-1" }, body: "{}" });
    expect(startResponse.status).toBe(200);
    const started = await startResponse.json() as { session: { id: string; profile_id: string; state: string }; archive: { profile_id: string; generation: number; size: number; sha256: string; format: string } };
    expect(started.session).toMatchObject({ id: "session-1", profile_id: "profile-1", state: "active" });
    expect(started.archive).toMatchObject({ profile_id: "profile-1", generation: 4, size: 4, sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", format: "zip" });
    const statusResponse = await fetch(`${server.url}/api/v1/sessions/session-1/status`, { headers: { Authorization: "Bearer bl_test_key_secret", Accept: "application/json" } });
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toMatchObject({ id: "session-1", profile_id: "profile-1", state: "active" });
    const stopResponse = await fetch(`${server.url}/api/v1/sessions/session-1/stop`, { method: "POST", headers: { Authorization: "Bearer bl_test_key_secret", Accept: "application/json", "Content-Type": "application/json", "Idempotency-Key": "stop-1" }, body: JSON.stringify({ archive: { storage_id: "storage-1", size: started.archive.size, sha256: started.archive.sha256, format: started.archive.format } }) });
    expect(stopResponse.status).toBe(200);
    expect(await stopResponse.json()).toMatchObject({ id: "session-1", profile_id: "profile-1", state: "stopped", status: "stopped", archive_generation: 5 });
    for (const status of [401, 409, 412, 422]) {
      const headers: Record<string, string> = status === 401 ? {} : { Authorization: "Bearer bl_test_key_secret", "x-mock-status": String(status) };
      const response = await fetch(`${server.url}/api/v1/profiles`, { headers });
      expect(response.status).toBe(status);
    }
    const download = await fetch(`${server.url}/api/v1/profiles/profile-1/archive/download?generation=4`, { headers: { Authorization: "Bearer bl_test_key_secret", "If-Match": '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' } });
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("DATA");
    const uploadUrl = await fetch(`${server.url}/api/v1/profiles/profile-1/archive-upload-url`, { method: "POST", headers: { Authorization: "Bearer bl_test_key_secret", "Content-Type": "application/json" }, body: "{}" });
    expect((await uploadUrl.json() as { upload_url: string }).upload_url).toBe("https://convex-storage.test/api/storage/upload/session-1");
  });

  it("rejects missing bearer", async () => {
    const server = await startBrowserLoginMock(); closers.push(server.close);
    const response = await fetch(`${server.url}/api/v1/profiles`);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer realm="BrowserLogin"');
  });

  it("negotiates stateless MCP, returns 202 notifications, and rejects GET/DELETE", async () => {
    const server = await startRemoteMcpMock(); closers.push(server.close);
    const post = (body: unknown) => fetch(server.url, { method: "POST", headers: { Authorization: "Bearer bl_test_key_secret", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const initialized = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect((await initialized.json() as { result: { protocolVersion: string } }).result.protocolVersion).toBe("2025-06-18");
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const listed = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const toolNames = ((await listed.json() as { result: { tools: Array<{ name: string }> } }).result.tools).map(tool => tool.name);
    expect(toolNames).toHaveLength(17);
    expect((await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "profiles_list", arguments: {} } })).status).toBe(200);
    expect((await fetch(server.url)).status).toBe(405);
    expect((await fetch(server.url, { method: "DELETE" })).status).toBe(405);
  });

  it("serves signed per-platform archives and fails the post-signing tamper check", async () => {
    const server = await startDistributionMock(); closers.push(server.close);
    const sumsResponse = await fetch(`${server.url}/SHA256SUMS`);
    const sums = await sumsResponse.json() as { checksums: string; signature: string; publicKey: string; label: string };
    expect(sums.label).toContain("TEST-ONLY");
    const publicKey = createPublicKey({ key: Buffer.from(sums.publicKey, "base64"), format: "der", type: "spki" });
    expect(verify(null, Buffer.from(sums.checksums), publicKey, Buffer.from(sums.signature, "base64"))).toBe(true);
    const archive = Buffer.from(await (await fetch(`${server.url}/archives/darwin-arm64.zip`)).arrayBuffer());
    expect(verifyTestOnlyChecksums(archive, "darwin-arm64")).toBe(true);
    expect(verifyTestOnlyChecksums(archive, "darwin-arm64", true)).toBe(false);
    expect(createHash("sha256").update(archive).digest("hex")).toMatch(/^[0-9a-f]{64}$/);
    const pro = await fetch(`${server.url}/pro/browser-archive`, { headers: { Authorization: "Bearer bl_test_key_secret" } });
    expect(pro.status).toBe(200);
    const missingBearer = await fetch(`${server.url}/api/download/v1.0.0`, { headers: { "X-Platform": "darwin-arm64" } });
    expect(missingBearer.status).toBe(401);
    expect(missingBearer.headers.get("www-authenticate")).toBe('Bearer realm="BrowserLogin"');
    const download = await fetch(`${server.url}/api/download/v1.0.0`, { headers: { Authorization: "Bearer bl_test_key_secret", "X-Platform": "darwin-arm64" } });
    expect(download.status).toBe(200);
    expect(download.headers.get("x-platform")).toBe("darwin-arm64");
    expect((await (await fetch(`${server.url}/api/download/v1.0.0`, { headers: { Authorization: "Bearer bl_test_key_secret" } })).json() as { error: string }).error).toContain("required");
    expect((await (await fetch(`${server.url}/api/download/v1.0.0`, { headers: { Authorization: "Bearer bl_test_key_secret", "X-Platform": "plan9" } })).json() as { error: string }).error).toContain("unsupported");
  });
});
