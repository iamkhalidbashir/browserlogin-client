import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { binaryVersionLock, withLock } from "../locks/index.js";
import { resolveStateRoot } from "../config/paths.js";
import { downloadVerifiedSource } from "./download.js";
import { installBinary, installedBinary } from "./install.js";
import {
  archiveName,
  resolveVersion,
  sourceArchiveUrl,
  officialArchiveUrl,
} from "./versions.js";
import { officialManifestBase, verifyArchive } from "./verify.js";
import {
  BinaryManagerError,
  type BinaryInfo,
  type EnsureBinaryOptions,
} from "./types.js";

export * from "./download.js";
export * from "./install.js";
export * from "./types.js";
export * from "./verify.js";
export * from "./versions.js";

async function isFile(path: string): Promise<boolean> {
  const info = await lstat(path).catch(() => undefined);
  return Boolean(info?.isFile());
}

async function fileHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function ensureBinary(
  options: EnsureBinaryOptions = {},
): Promise<BinaryInfo> {
  const env = options.env ?? process.env;
  const override = env.CLOAKBROWSER_BINARY_PATH;
  if (override) {
    if (!(await isFile(override)))
      throw new BinaryManagerError(
        `CLOAKBROWSER_BINARY_PATH points to a missing file: ${override}`,
        "INSTALL_FAILED",
      );
    return {
      path: override,
      version: undefined,
      platform: undefined,
      pro: false,
      sha256: undefined,
      binarySha256: undefined,
      source: "custom",
      trust: "override",
    };
  }
  const customSource = options.downloadUrl ?? env.CLOAKBROWSER_DOWNLOAD_URL;
  const resolved = await resolveVersion({
    ...options,
    pro: options.pro ?? Boolean(options.licenseKey),
    requestedVersion: options.requestedVersion,
    env,
    proVersionUrl: customSource
      ? `${customSource.replace(/\/$/, "")}/api/download/version`
      : options.proVersionUrl,
  });
  const root =
    options.cacheDirectory ??
    env.CLOAKBROWSER_CACHE_DIR ??
    resolveStateRoot({ env });
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())
    throw new BinaryManagerError(
      "CloakBrowser cache root is not a directory",
      "INSTALL_FAILED",
    );
  await chmod(root, 0o700);
  const existing = await installedBinary(
    root,
    resolved.version,
    resolved.pro,
    resolved.platform,
  );
  if (
    existing &&
    existing.binarySha256 &&
    existing.binarySha256 === (await fileHash(existing.path))
  )
    return { ...existing, platform: resolved.platform };
  const lockDirectory = join(root, "locks");
  await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
  return withLock(
    binaryVersionLock(
      lockDirectory,
      `${resolved.platform}-${resolved.version}-${resolved.pro ? "pro" : "free"}`,
    ),
    async () => {
      const lockedExisting = await installedBinary(
        root,
        resolved.version,
        resolved.pro,
        resolved.platform,
      );
      if (
        lockedExisting &&
        lockedExisting.binarySha256 &&
        lockedExisting.binarySha256 === (await fileHash(lockedExisting.path))
      )
        return { ...lockedExisting, platform: resolved.platform };
      const custom = customSource;
      const source = custom ? ("custom" as const) : ("official" as const);
      const archiveUrl = custom
        ? sourceArchiveUrl(custom, resolved.platform)
        : resolved.pro
          ? `${new URL(`/api/download/${resolved.version}`, "https://cloakbrowser.dev").toString()}`
          : officialArchiveUrl(resolved.platform, resolved.version);
      const headers =
        resolved.pro && options.licenseKey
          ? {
              Authorization: `Bearer ${options.licenseKey}`,
              "X-Platform": resolved.platform,
            }
          : undefined;
      const archive = join(
        root,
        "downloads",
        `${resolved.version}-${resolved.platform}${resolved.pro ? "-pro" : ""}.${archiveName(resolved.platform).split(".").slice(1).join(".")}`,
      );
      await downloadVerifiedSource({
        url: archiveUrl,
        destination: archive,
        headers,
        progress: options.progress,
        fetchImpl: options.fetchImpl,
        diskSpace: options.diskSpace,
      });
      const manifestBase = custom
        ? custom.replace(/\/(?:[^/]+\.(?:zip|tar\.gz))$/, "")
        : officialManifestBase(resolved.version, resolved.pro);
      const verification = await verifyArchive(
        archive,
        resolved.platform,
        resolved.version,
        source,
        manifestBase,
        headers,
        options.fetchImpl ?? fetch,
      );
      const info = await installBinary({
        archive,
        root,
        version: resolved.version,
        pro: resolved.pro,
        platform: resolved.platform,
        sha256: verification.sha256,
        source,
        trust: verification.trust,
        healthCallback: options.healthCallback,
      });
      return { ...info, source, trust: verification.trust };
    },
    { timeoutMs: 30 * 60 * 1000 },
  );
}
