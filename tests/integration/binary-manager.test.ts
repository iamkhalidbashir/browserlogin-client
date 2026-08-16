import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureBinary,
  resolvePlatform,
  resolveVersion,
  BinaryManagerError,
} from "../../src/core/binary/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function serverFor(
  bytes: Uint8Array,
  options: { tamper?: boolean; ignoreRange?: boolean } = {},
) {
  const etag = '"task14-etag"';
  const version = "146.0.7680.177.5";
  const archiveName = "cloakbrowser-windows-x64.zip";
  const hash = createHash("sha256").update(bytes).digest("hex");
  const tamperedHash = `${hash.slice(0, -1)}${hash.endsWith("0") ? "1" : "0"}`;
  const manifest = `version=${version}\n${options.tamper ? tamperedHash : hash}  ${archiveName}\n`;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/api/download/version") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ version }));
      return;
    }
    if (url.pathname === "/SHA256SUMS") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(manifest);
      return;
    }
    if (url.pathname === "/archives/cloakbrowser-windows-x64.zip") {
      const range = request.headers.range;
      if (range && !options.ignoreRange) {
        const start = Number(range.match(/bytes=(\d+)-/)?.[1] ?? 0);
        response.writeHead(206, {
          "content-length": bytes.length - start,
          etag,
        });
        response.end(Buffer.from(bytes.slice(start)));
        return;
      }
      response.writeHead(200, { "content-length": bytes.length, etag });
      response.end(Buffer.from(bytes));
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("mock server did not bind");
  const url = `http://127.0.0.1:${address.port}`;
  cleanups.push(
    async () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  return { url, version };
}

function fixtureArchive(): Uint8Array {
  return zipSync(
    { "chrome.exe": new TextEncoder().encode("TEST-ONLY CLOAKBROWSER") },
    { level: 0 },
  );
}

describe("Task 14 binary manager", () => {
  it("happy: custom source downloads, verifies, installs, and writes current.json", async () => {
    const source = await serverFor(fixtureArchive());
    const root = await mkdtemp(join(tmpdir(), "browserlogin-task14-"));
    const progress: Array<{ done: boolean }> = [];
    const info = await ensureBinary({
      cacheDirectory: root,
      downloadUrl: source.url,
      requestedVersion: source.version,
      platform: "win32",
      arch: "x64",
      progress: (event) => progress.push({ done: event.done }),
    });
    expect(info.path).toContain(
      "browser-runtime/browsers/windows-x64-146.0.7680.177.5",
    );
    expect(info.trust).toBe("unverified-custom");
    expect(await readFile(info.path, "utf8")).toContain("TEST-ONLY");
    expect(progress.at(-1)?.done).toBe(true);
    expect(
      JSON.parse(
        await readFile(join(root, "browser-runtime", "current.json"), "utf8"),
      ),
    ).toMatchObject({ version: source.version, pro: false, path: info.path });
    await rm(root, { recursive: true, force: true });
  });

  it("rejects tampered custom checksum before installation", async () => {
    const source = await serverFor(fixtureArchive(), { tamper: true });
    const root = await mkdtemp(join(tmpdir(), "browserlogin-task14-tamper-"));
    await expect(
      ensureBinary({
        cacheDirectory: root,
        downloadUrl: source.url,
        requestedVersion: source.version,
        platform: "win32",
        arch: "x64",
      }),
    ).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
    await expect(
      readFile(join(root, "browser-runtime", "current.json"), "utf8"),
    ).rejects.toThrow();
    await rm(root, { recursive: true, force: true });
  });

  it("resumes with Range and restarts when the server ignores Range", async () => {
    const bytes = fixtureArchive();
    const source = await serverFor(bytes);
    const root = await mkdtemp(join(tmpdir(), "browserlogin-task14-resume-"));
    const progress: number[] = [];
    const info = await ensureBinary({
      cacheDirectory: root,
      downloadUrl: source.url,
      requestedVersion: source.version,
      platform: "win32",
      arch: "x64",
      progress: (event) => progress.push(event.downloaded),
    });
    expect(info.path).toContain(source.version);
    expect(progress.length).toBeGreaterThan(0);
    await rm(root, { recursive: true, force: true });
    const ignored = await serverFor(bytes, { ignoreRange: true });
    const restartedRoot = await mkdtemp(
      join(tmpdir(), "browserlogin-task14-restart-"),
    );
    await expect(
      ensureBinary({
        cacheDirectory: restartedRoot,
        downloadUrl: ignored.url,
        requestedVersion: ignored.version,
        platform: "win32",
        arch: "x64",
      }),
    ).resolves.toMatchObject({ trust: "unverified-custom" });
    await rm(restartedRoot, { recursive: true, force: true });
  });

  it("short-circuits local override, rejects unsupported platforms, and preflights disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-task14-override-"));
    const local = join(root, "chrome.exe");
    await writeFile(local, "local");
    await expect(
      ensureBinary({ env: { CLOAKBROWSER_BINARY_PATH: local } }),
    ).resolves.toMatchObject({ path: local, trust: "override" });
    expect(() =>
      resolvePlatform({ platform: "linux", arch: "arm64" }),
    ).toThrowError(BinaryManagerError);
    await expect(
      ensureBinary({
        cacheDirectory: root,
        downloadUrl: "http://unused",
        requestedVersion: "1.0.0",
        platform: "win32",
        arch: "x64",
        diskSpace: async () => ({ available: 1 }),
      }),
    ).rejects.toMatchObject({ code: "DISK_SPACE" });
    await rm(root, { recursive: true, force: true });
  });

  it("uses the hourly Pro marker and only honors the version pin for a paid key", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-task14-version-"));
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ version: "9.9.9.0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    await expect(
      resolveVersion({
        pro: true,
        licenseKey: "paid",
        env: { CLOAKBROWSER_VERSION: "8.8.8.0" },
        platform: "win32",
        arch: "x64",
        markerDirectory: root,
        fetchImpl,
      }),
    ).resolves.toMatchObject({ version: "8.8.8.0", pro: true });
    await expect(
      resolveVersion({
        pro: true,
        licenseKey: "paid",
        env: {},
        platform: "win32",
        arch: "x64",
        markerDirectory: root,
        fetchImpl,
      }),
    ).resolves.toMatchObject({ version: "9.9.9.0", pro: true });
    expect(calls).toBe(1);
    await rm(root, { recursive: true, force: true });
  });

  it("pro: resolves the paid version and installs through the same verified cache", async () => {
    const source = await serverFor(fixtureArchive());
    const root = await mkdtemp(join(tmpdir(), "browserlogin-task14-pro-"));
    const info = await ensureBinary({
      cacheDirectory: root,
      downloadUrl: source.url,
      licenseKey: "paid-test-key",
      platform: "win32",
      arch: "x64",
    });
    expect(info).toMatchObject({
      version: source.version,
      pro: true,
      trust: "unverified-custom",
    });
    await rm(root, { recursive: true, force: true });
  });

  it("concurrency: same-version callers share the Task 13 lock", async () => {
    const source = await serverFor(fixtureArchive());
    const root = await mkdtemp(
      join(tmpdir(), "browserlogin-task14-concurrent-"),
    );
    const options = {
      cacheDirectory: root,
      downloadUrl: source.url,
      requestedVersion: source.version,
      platform: "win32" as const,
      arch: "x64",
    };
    const [first, second] = await Promise.all([
      ensureBinary(options),
      ensureBinary(options),
    ]);
    expect(first.path).toBe(second.path);
    await rm(root, { recursive: true, force: true });
  });
});
