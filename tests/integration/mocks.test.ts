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
    const server = await startDistributionMock(); closers.push(server.close);
    const response = await fetch(`${server.url}/api/download/v1.0.0`, { headers: { "X-Platform": "darwin-arm64" } });
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
    const toolNames = ((await listed.json() as { result: { structuredContent: { result: Array<{ name: string }> } } }).result.structuredContent.result).map(tool => tool.name);
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
    const download = await fetch(`${server.url}/api/download/v1.0.0`, { headers: { Authorization: "Bearer bl_test_key_secret", "X-Platform": "darwin-arm64" } });
    expect(download.status).toBe(200);
    expect(download.headers.get("x-platform")).toBe("darwin-arm64");
    expect((await (await fetch(`${server.url}/api/download/v1.0.0`, { headers: { Authorization: "Bearer bl_test_key_secret" } })).json() as { error: string }).error).toContain("required");
    expect((await (await fetch(`${server.url}/api/download/v1.0.0`, { headers: { Authorization: "Bearer bl_test_key_secret", "X-Platform": "plan9" } })).json() as { error: string }).error).toContain("unsupported");
  });
});
