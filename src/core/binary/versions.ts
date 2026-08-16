import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BinaryManagerError,
  type BinaryPlatform,
  type VersionResolutionOptions,
} from "./types.js";

export const FALLBACK_VERSIONS: Readonly<Record<BinaryPlatform, string>> =
  Object.freeze({
    "darwin-arm64": "145.0.7632.109.2",
    "windows-x64": "146.0.7680.177.5",
    "linux-x64": "146.0.7680.177.5",
  });

export const OFFICIAL_DOWNLOAD_BASE = "https://cloakbrowser.dev";
export const GITHUB_RELEASES_API =
  "https://api.github.com/repos/CloakHQ/cloakbrowser/releases";
const HOUR_MS = 60 * 60 * 1000;

export function resolvePlatform(
  options: { platform?: string; arch?: string } = {},
): BinaryPlatform {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "win32" && arch === "x64") return "windows-x64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  throw new BinaryManagerError(
    `Unsupported CloakBrowser platform: ${platform}-${arch}. Supported platforms are darwin-arm64, windows-x64, and linux-x64.`,
    "UNSUPPORTED_PLATFORM",
  );
}

export function archiveName(platform: BinaryPlatform): string {
  return `cloakbrowser-${platform}.${platform === "windows-x64" ? "zip" : "tar.gz"}`;
}

export function fallbackVersion(platform: BinaryPlatform): string {
  return FALLBACK_VERSIONS[platform];
}

export function validateVersion(version: string): string {
  if (!/^\d+\.\d+\.\d+\.\d+(?:\.\d+)?$/.test(version))
    throw new BinaryManagerError(
      `Invalid CloakBrowser version: ${version}`,
      "VERSION_UNAVAILABLE",
    );
  return version;
}

function markerPath(
  directory: string,
  platform: BinaryPlatform,
  pro: boolean,
): string {
  return join(directory, `${pro ? "latest-pro" : "latest"}-${platform}.json`);
}

async function readMarker(
  path: string,
): Promise<{ version: string; checkedAt: number } | undefined> {
  try {
    const marker = JSON.parse(await readFile(path, "utf8")) as Partial<{
      version: string;
      checkedAt: number;
    }>;
    if (
      typeof marker.version === "string" &&
      typeof marker.checkedAt === "number"
    )
      return marker as { version: string; checkedAt: number };
  } catch {
    return undefined;
  }
  return undefined;
}

async function writeMarker(
  path: string,
  marker: { version: string; checkedAt: number },
): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function versionFromTag(tag: string): string | undefined {
  const match = tag.match(/v?(\d+\.\d+\.\d+\.\d+(?:\.\d+)?)/);
  return match?.[1];
}

async function discoverFree(
  platform: BinaryPlatform,
  options: VersionResolutionOptions,
): Promise<string> {
  const markerDirectory = options.markerDirectory;
  const now = options.now?.() ?? Date.now();
  const marker = markerDirectory
    ? await readMarker(markerPath(markerDirectory, platform, false))
    : undefined;
  if (marker && now - marker.checkedAt < HOUR_MS) return marker.version;
  try {
    const response = await (options.fetchImpl ?? fetch)(
      options.githubApiUrl ?? GITHUB_RELEASES_API,
      {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const releases = (await response.json()) as Array<{
      tag_name?: string;
      draft?: boolean;
      prerelease?: boolean;
      assets?: Array<{ name?: string }>;
    }>;
    const archive = archiveName(platform);
    const release = releases.find(
      (item) =>
        !item.draft &&
        !item.prerelease &&
        item.assets?.some((asset) => asset.name === archive),
    );
    const version = versionFromTag(release?.tag_name ?? "");
    if (!version) throw new Error("no matching release asset");
    if (markerDirectory)
      await writeMarker(markerPath(markerDirectory, platform, false), {
        version,
        checkedAt: now,
      });
    return version;
  } catch {
    return marker?.version ?? fallbackVersion(platform);
  }
}

async function discoverPro(
  platform: BinaryPlatform,
  options: VersionResolutionOptions,
): Promise<string> {
  const markerDirectory = options.markerDirectory;
  const now = options.now?.() ?? Date.now();
  const marker = markerDirectory
    ? await readMarker(markerPath(markerDirectory, platform, true))
    : undefined;
  if (marker && now - marker.checkedAt < HOUR_MS) return marker.version;
  const response = await (options.fetchImpl ?? fetch)(
    options.proVersionUrl ?? `${OFFICIAL_DOWNLOAD_BASE}/api/download/version`,
    {
      headers: {
        Authorization: `Bearer ${options.licenseKey}`,
        "X-Platform": platform,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok)
    throw new BinaryManagerError(
      `Unable to resolve Pro CloakBrowser version: HTTP ${response.status}`,
      "VERSION_UNAVAILABLE",
    );
  const payload = (await response.json()) as {
    version?: string;
    latest?: string;
  };
  const version = payload.version ?? payload.latest;
  if (!version)
    throw new BinaryManagerError(
      "Pro version response did not contain a version",
      "VERSION_UNAVAILABLE",
    );
  if (markerDirectory)
    await writeMarker(markerPath(markerDirectory, platform, true), {
      version,
      checkedAt: now,
    });
  return version;
}

export async function resolveVersion(
  options: VersionResolutionOptions = {},
): Promise<{ platform: BinaryPlatform; version: string; pro: boolean }> {
  const platform = resolvePlatform(options);
  const env = options.env ?? process.env;
  const pro = Boolean(options.pro && options.licenseKey);
  if (pro && (options.requestedVersion ?? env.CLOAKBROWSER_VERSION)) {
    return {
      platform,
      version: validateVersion(
        options.requestedVersion ?? env.CLOAKBROWSER_VERSION!,
      ),
      pro,
    };
  }
  if (pro)
    return {
      platform,
      version: validateVersion(await discoverPro(platform, options)),
      pro,
    };
  return {
    platform,
    version: validateVersion(await discoverFree(platform, options)),
    pro: false,
  };
}

export function sourceArchiveUrl(
  base: string,
  platform: BinaryPlatform,
): string {
  if (/\.(?:zip|tar\.gz)$/i.test(base)) return base;
  return `${base.replace(/\/$/, "")}/archives/${archiveName(platform)}`;
}

export function officialArchiveUrl(
  platform: BinaryPlatform,
  version: string,
): string {
  return `${OFFICIAL_DOWNLOAD_BASE}/chromium-v${version}/${archiveName(platform)}`;
}
