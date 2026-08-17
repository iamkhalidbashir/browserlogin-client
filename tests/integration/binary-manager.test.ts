import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureBinary,
  downloadVerifiedSource,
  resolvePlatform,
  resolveVersion,
  BinaryManagerError,
} from "../../src/core/binary/index.js";
import { lockName } from "../../src/core/locks/index.js";
import { setTestOfficialSigningPublicKey } from "../../src/core/binary/test-seam.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  setTestOfficialSigningPublicKey(undefined);
  while (cleanups.length) await cleanups.pop()?.();
});

async function serverFor(
  bytes: Uint8Array,
  options: {
    tamperManifest?: boolean;
    tamperArchive?: boolean;
    versionMismatch?: boolean;
    tamperSignature?: boolean;
    ignoreRange?: boolean;
    changedEtag?: boolean;
    official?: boolean;
  } = {},
) {
  const etag = '"task14-etag"';
  const changedEtag = '"task14-changed-etag"';
  const version = "146.0.7680.177.5";
  const archiveName = "cloakbrowser-windows-x64.zip";
  const servedBytes = options.tamperArchive
    ? Buffer.concat([Buffer.from(bytes), Buffer.from("tamper")])
    : Buffer.from(bytes);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const tamperedHash = `${hash.slice(0, -1)}${hash.endsWith("0") ? "1" : "0"}`;
  const manifest = `version=${options.versionMismatch ? "1.2.3.4" : version}\n${options.tamperManifest ? tamperedHash : hash}  ${archiveName}\n`;
  const keyPair = generateKeyPairSync("ed25519");
  const validSignature = sign(
    null,
    Buffer.from(manifest),
    keyPair.privateKey,
  ).toString("base64");
  const signature = options.tamperSignature
    ? `${validSignature.slice(0, -1)}${validSignature.endsWith("A") ? "B" : "A"}`
    : validSignature;
  const publicKey = Buffer.from(
    (keyPair.publicKey.export({ format: "jwk" }) as { x?: string }).x!,
    "base64url",
  ).toString("base64");
  const requests: Array<{
    method: string;
    path: string;
    range?: string;
    ifRange?: string;
    authorization?: string;
    platform?: string;
  }> = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({
      method: request.method ?? "GET",
      path: url.pathname,
      range:
        typeof request.headers.range === "string"
          ? request.headers.range
          : undefined,
      ifRange:
        typeof request.headers["if-range"] === "string"
          ? request.headers["if-range"]
          : undefined,
      authorization:
        typeof request.headers.authorization === "string"
          ? request.headers.authorization
          : undefined,
      platform:
        typeof request.headers["x-platform"] === "string"
          ? request.headers["x-platform"]
          : undefined,
    });
    if (url.pathname === "/api/download/version") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ version }));
      return;
    }
    if (url.pathname.endsWith("/SHA256SUMS")) {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(manifest);
      return;
    }
    if (url.pathname.endsWith("/SHA256SUMS.sig")) {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(signature);
      return;
    }
    if (
      url.pathname === "/archives/cloakbrowser-windows-x64.zip" ||
      url.pathname.endsWith("/cloakbrowser-windows-x64.zip") ||
      url.pathname === `/api/download/${version}`
    ) {
      const range = request.headers.range;
      if (range && !options.ignoreRange) {
        const start = Number(range.match(/bytes=(\d+)-/)?.[1] ?? 0);
        response.writeHead(206, {
          "content-length": servedBytes.length - start,
          etag: options.changedEtag ? changedEtag : etag,
        });
        response.end(servedBytes.subarray(start));
        return;
      }
      response.writeHead(200, { "content-length": servedBytes.length, etag });
      response.end(servedBytes);
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
  return { url, version, requests, manifest, publicKey };
}

function officialFetch(localUrl: string) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const original = new URL(input.toString());
    if (
      original.origin === "https://cloakbrowser.dev" ||
      original.origin === "https://github.com" ||
      original.origin === "https://api.github.com"
    ) {
      return fetch(`${localUrl}${original.pathname}${original.search}`, init);
    }
    return fetch(input, init);
  }) as typeof fetch;
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
    expect(info.path.replaceAll("\\", "/")).toContain(
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
    const source = await serverFor(fixtureArchive(), { tamperManifest: true });
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
    const archive = join(
      root,
      "downloads",
      `${source.version}-windows-x64-custom-${lockName(source.url)}.zip`,
    );
    await mkdir(join(root, "downloads"), { recursive: true });
    const partial = Math.max(1, Math.floor(bytes.length * 0.4));
    await writeFile(`${archive}.part`, bytes.subarray(0, partial));
    await writeFile(`${archive}.part.etag`, '"task14-etag"');
    const info = await ensureBinary({
      cacheDirectory: root,
      downloadUrl: source.url,
      requestedVersion: source.version,
      platform: "win32",
      arch: "x64",
    });
    expect(info.path).toContain(source.version);
    const range = source.requests.find((request) => request.range);
    expect(range?.range).toBe(`bytes=${partial}-`);
    expect(range?.ifRange).toBe('"task14-etag"');
    expect(await stat(archive)).toMatchObject({ size: bytes.length });
    await rm(root, { recursive: true, force: true });
  });

  it("restarts once when Range is ignored or the ETag changes", async () => {
    const bytes = fixtureArchive();
    for (const mode of ["ignored", "changed"] as const) {
      const source = await serverFor(bytes, {
        ignoreRange: mode === "ignored",
        changedEtag: mode === "changed",
      });
      const root = await mkdtemp(
        join(tmpdir(), `browserlogin-task14-${mode}-`),
      );
      const archive = join(
        root,
        "downloads",
        `${source.version}-windows-x64-custom-${lockName(source.url)}.zip`,
      );
      await mkdir(join(root, "downloads"), { recursive: true });
      const partial = Math.max(1, Math.floor(bytes.length * 0.4));
      await writeFile(`${archive}.part`, bytes.subarray(0, partial));
      await writeFile(`${archive}.part.etag`, '"task14-etag"');
      await expect(
        ensureBinary({
          cacheDirectory: root,
          downloadUrl: source.url,
          requestedVersion: source.version,
          platform: "win32",
          arch: "x64",
        }),
      ).resolves.toMatchObject({ trust: "unverified-custom" });
      const archiveGets = source.requests.filter(
        (request) => request.path.endsWith(".zip") && request.method === "GET",
      );
      expect(archiveGets[0]?.range).toBe(`bytes=${partial}-`);
      expect(archiveGets[0]?.ifRange).toBe('"task14-etag"');
      expect(archiveGets.at(-1)?.range).toBeUndefined();
      expect(archiveGets).toHaveLength(2);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("official free flow discovers at cloakbrowser.dev and verifies its signed manifest", async () => {
    const source = await serverFor(fixtureArchive(), { official: true });
    setTestOfficialSigningPublicKey(source.publicKey);
    const root = await mkdtemp(
      join(tmpdir(), "browserlogin-task14-official-free-"),
    );
    const info = await ensureBinary({
      cacheDirectory: root,
      platform: "win32",
      arch: "x64",
      fetchImpl: officialFetch(source.url),
    });
    expect(info).toMatchObject({
      version: source.version,
      pro: false,
      trust: "verified",
    });
    const versionRequest = source.requests.find(
      (request) => request.path === "/api/download/version",
    );
    const archiveRequest = source.requests.find((request) =>
      request.path.endsWith("/cloakbrowser-windows-x64.zip"),
    );
    expect(versionRequest?.authorization).toBeUndefined();
    expect(versionRequest?.platform).toBeUndefined();
    expect(archiveRequest?.authorization).toBeUndefined();
    expect(archiveRequest?.platform).toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });

  it("official Pro flow sends Bearer and X-Platform and verifies the signed manifest", async () => {
    const source = await serverFor(fixtureArchive(), { official: true });
    setTestOfficialSigningPublicKey(source.publicKey);
    const root = await mkdtemp(
      join(tmpdir(), "browserlogin-task14-official-pro-"),
    );
    const info = await ensureBinary({
      cacheDirectory: root,
      licenseKey: "bl_test_key_secret",
      platform: "win32",
      arch: "x64",
      fetchImpl: officialFetch(source.url),
    });
    expect(info).toMatchObject({
      version: source.version,
      pro: true,
      trust: "verified",
    });
    for (const request of source.requests.filter(
      (item) =>
        item.path === "/api/download/version" ||
        item.path === `/api/download/${source.version}`,
    )) {
      expect(request.authorization).toBe("Bearer bl_test_key_secret");
      expect(request.platform).toBe("windows-x64");
    }
    await rm(root, { recursive: true, force: true });
  });

  it("production official verification rejects an alternate signing key", async () => {
    const source = await serverFor(fixtureArchive(), { official: true });
    const root = await mkdtemp(
      join(tmpdir(), "browserlogin-task14-pinned-key-"),
    );
    await expect(
      ensureBinary({
        cacheDirectory: root,
        platform: "win32",
        arch: "x64",
        fetchImpl: officialFetch(source.url),
      }),
    ).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
    await rm(root, { recursive: true, force: true });
  });

  it("keeps official and custom same-version installs in separate cache identities", async () => {
    const source = await serverFor(fixtureArchive(), { official: true });
    const root = await mkdtemp(
      join(tmpdir(), "browserlogin-task14-source-identity-"),
    );
    setTestOfficialSigningPublicKey(source.publicKey);
    const official = await ensureBinary({
      cacheDirectory: root,
      platform: "win32",
      arch: "x64",
      fetchImpl: officialFetch(source.url),
    });
    const custom = await ensureBinary({
      cacheDirectory: root,
      downloadUrl: source.url,
      requestedVersion: source.version,
      platform: "win32",
      arch: "x64",
    });
    expect(custom.path).not.toBe(official.path);
    expect(custom.trust).toBe("unverified-custom");
    await rm(root, { recursive: true, force: true });
  });

  it.each([
    ["signature", { tamperSignature: true }],
    ["archive SHA", { tamperArchive: true }],
    ["signed version", { versionMismatch: true }],
  ] as const)("official %s tampering fails closed", async (_label, options) => {
    const source = await serverFor(fixtureArchive(), {
      official: true,
      ...options,
    });
    setTestOfficialSigningPublicKey(source.publicKey);
    const root = await mkdtemp(
      join(tmpdir(), "browserlogin-task14-official-failure-"),
    );
    await expect(
      ensureBinary({
        cacheDirectory: root,
        platform: "win32",
        arch: "x64",
        fetchImpl: officialFetch(source.url),
      }),
    ).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
    await expect(
      readFile(join(root, "browser-runtime", "current.json")),
    ).rejects.toThrow();
    await rm(root, { recursive: true, force: true });
  });

  it("falls back from the official manifest endpoint to the signed GitHub release", async () => {
    const source = await serverFor(fixtureArchive(), { official: true });
    setTestOfficialSigningPublicKey(source.publicKey);
    const root = await mkdtemp(
      join(tmpdir(), "browserlogin-task14-manifest-fallback-"),
    );
    const originalFetch = officialFetch(source.url);
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (
        url.pathname.endsWith("/SHA256SUMS") &&
        url.origin === "https://cloakbrowser.dev"
      )
        return new Response("not found", { status: 404 });
      return originalFetch(input, init);
    }) as unknown as typeof fetch;
    await expect(
      ensureBinary({
        cacheDirectory: root,
        platform: "win32",
        arch: "x64",
        fetchImpl,
      }),
    ).resolves.toMatchObject({ trust: "verified" });
    await rm(root, { recursive: true, force: true });
  });

  it("falls back from the cloakbrowser.dev archive to the GitHub release", async () => {
    const source = await serverFor(fixtureArchive(), { official: true });
    setTestOfficialSigningPublicKey(source.publicKey);
    const root = await mkdtemp(
      join(tmpdir(), "browserlogin-task14-archive-fallback-"),
    );
    const originalFetch = officialFetch(source.url);
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (
        url.origin === "https://cloakbrowser.dev" &&
        url.pathname.endsWith(".zip")
      )
        return new Response("not found", { status: 404 });
      return originalFetch(input, init);
    }) as typeof fetch;
    await expect(
      ensureBinary({
        cacheDirectory: root,
        platform: "win32",
        arch: "x64",
        fetchImpl,
      }),
    ).resolves.toMatchObject({ trust: "verified" });
    expect(
      source.requests.some((request) =>
        request.path.includes("/releases/download/v"),
      ),
    ).toBe(true);
    await rm(root, { recursive: true, force: true });
  });

  it("does not retry deterministic HTTP failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-task14-retry-"));
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("no", { status: 503 });
    }) as unknown as typeof fetch;
    await expect(
      downloadVerifiedSource({
        url: "http://test.invalid/archive.zip",
        destination: join(root, "archive.zip"),
        fetchImpl,
        retries: 4,
        expectedBytes: 1,
      }),
    ).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
    expect(calls).toBe(1);
    await rm(root, { recursive: true, force: true });
  });

  it("retries a network failure but stops after the successful transfer", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "browserlogin-task14-network-retry-"),
    );
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) throw new Error("connection reset");
      return new Response("x", {
        status: 200,
        headers: { "content-length": "1" },
      });
    }) as unknown as typeof fetch;
    await expect(
      downloadVerifiedSource({
        url: "http://test.invalid/archive.zip",
        destination: join(root, "archive.zip"),
        fetchImpl,
        expectedBytes: 1,
        retries: 3,
      }),
    ).resolves.toContain("archive.zip");
    expect(calls).toBe(2);
    await rm(root, { recursive: true, force: true });
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
        requestedVersion: "1.0.0.0",
        platform: "win32",
        arch: "x64",
        diskSpace: async () => ({ available: 1 }),
      }),
    ).rejects.toMatchObject({ code: "DISK_SPACE" });
    await rm(root, { recursive: true, force: true });
  });

  it("uses the hourly Pro marker and only honors the version pin for a paid key", async () => {
    const root = await mkdtemp(join(tmpdir(), "browserlogin-task14-version-"));
    const freeCalls: Array<{ url: string; headers: Headers }> = [];
    const freeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      freeCalls.push({
        url: input.toString(),
        headers: new Headers(init?.headers),
      });
      return new Response(
        JSON.stringify([
          {
            tag_name: "v8.8.8.0",
            draft: true,
            assets: [{ name: "cloakbrowser-windows-x64.zip" }],
          },
          {
            tag_name: "v7.7.7.0",
            prerelease: true,
            assets: [{ name: "cloakbrowser-windows-x64.zip" }],
          },
          {
            tag_name: "v6.6.6.0",
            assets: [{ name: "cloakbrowser-linux-x64.tar.gz" }],
          },
          {
            tag_name: "v5.5.5.0",
            assets: [{ name: "cloakbrowser-windows-x64.zip" }],
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    await expect(
      resolveVersion({
        platform: "win32",
        arch: "x64",
        githubApiUrl:
          "https://api.github.test/repos/CloakHQ/cloakbrowser/releases",
        fetchImpl: freeFetch,
        markerDirectory: root,
        now: () => 10_000,
      }),
    ).resolves.toMatchObject({ version: "5.5.5.0", pro: false });
    expect(freeCalls).toHaveLength(1);
    expect(freeCalls[0]?.url).toBe(
      "https://api.github.test/repos/CloakHQ/cloakbrowser/releases",
    );
    expect(freeCalls[0]?.headers.get("accept")).toBe(
      "application/vnd.github+json",
    );
    expect(freeCalls[0]?.headers.has("authorization")).toBe(false);
    expect(freeCalls[0]?.headers.has("x-platform")).toBe(false);
    expect(freeCalls[0]?.url).not.toContain(
      "cloakbrowser.dev/api/download/version",
    );

    await writeFile(
      join(root, "latest-windows-x64.json"),
      JSON.stringify({ version: "4.4.4.0", checkedAt: 9_500 }),
    );
    const markerOnly = (async () => {
      throw new Error("fresh marker must suppress GitHub discovery");
    }) as unknown as typeof fetch;
    await expect(
      resolveVersion({
        platform: "win32",
        arch: "x64",
        fetchImpl: markerOnly,
        markerDirectory: root,
        now: () => 10_000,
      }),
    ).resolves.toMatchObject({ version: "4.4.4.0", pro: false });

    await writeFile(
      join(root, "latest-windows-x64.json"),
      JSON.stringify({ version: "3.3.3.0", checkedAt: 0 }),
    );
    const failedGithub = (async () =>
      new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
    await expect(
      resolveVersion({
        platform: "win32",
        arch: "x64",
        fetchImpl: failedGithub,
        markerDirectory: root,
        now: () => 10_000,
      }),
    ).resolves.toMatchObject({ version: "3.3.3.0", pro: false });
    await rm(join(root, "latest-windows-x64.json"));
    await expect(
      resolveVersion({
        platform: "win32",
        arch: "x64",
        fetchImpl: failedGithub,
        markerDirectory: root,
        now: () => 10_000,
      }),
    ).resolves.toMatchObject({ version: "146.0.7680.177.5", pro: false });

    let proCalls = 0;
    const proFetch = (async () => {
      proCalls += 1;
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
        fetchImpl: proFetch,
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
        fetchImpl: proFetch,
      }),
    ).resolves.toMatchObject({ version: "9.9.9.0", pro: true });
    expect(proCalls).toBe(1);
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

  it("concurrency: separate processes perform one download and publish atomic current.json", async () => {
    const source = await serverFor(fixtureArchive());
    const root = await mkdtemp(
      join(tmpdir(), "browserlogin-task14-processes-"),
    );
    const fixture = fileURLToPath(
      new URL("../fixtures/binary-concurrency-child.ts", import.meta.url),
    );
    const bun = process.env.BUN_BIN ?? "bun";
    const children = Array.from({ length: 2 }, () =>
      spawn(bun, [fixture, root, source.url, source.version], {
        stdio: "pipe",
      }),
    );
    const results = await Promise.all(
      children.map(
        (child) =>
          new Promise<{ code: number; stderr: string }>((resolve) => {
            let stderr = "";
            child.stderr?.on("data", (chunk: Buffer) => {
              stderr += chunk.toString();
            });
            child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
          }),
      ),
    );
    expect(results, results.map((result) => result.stderr).join("\n")).toEqual([
      { code: 0, stderr: "" },
      { code: 0, stderr: "" },
    ]);
    expect(
      source.requests.filter(
        (request) =>
          request.path === "/archives/cloakbrowser-windows-x64.zip" &&
          request.method === "GET",
      ),
    ).toHaveLength(1);
    const pointer = JSON.parse(
      await readFile(join(root, "browser-runtime", "current.json"), "utf8"),
    ) as { path: string; version: string };
    expect(pointer.version).toBe(source.version);
    expect(pointer.path).toContain(`windows-x64-${source.version}`);
    await rm(root, { recursive: true, force: true });
  }, 20_000);
});
