import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { resolvePlatform } from "./versions.js";
import type { BinaryInfo, BinaryPlatformInput, BinarySource } from "./types.js";

const pointerSchema = z
  .object({
    version: z.string().min(1),
    pro: z.boolean(),
    path: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    source: z.enum(["official", "custom"]),
    trust: z.enum(["verified", "unverified-custom"]),
    binary_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strip();

export type ActiveBinaryOptions = BinaryPlatformInput & {
  readonly env?: NodeJS.ProcessEnv;
};

async function fileHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function usableBinary(path: string, platform: string): Promise<boolean> {
  const info = await lstat(path).catch(() => undefined);
  return Boolean(
    info?.isFile() && (platform === "windows-x64" || (info.mode & 0o111) !== 0),
  );
}

function trustedSource(
  source: BinarySource,
  trust: BinaryInfo["trust"],
): boolean {
  return (
    (source === "official" && trust === "verified") ||
    (source === "custom" && trust === "unverified-custom")
  );
}

export async function readActiveBinary(
  root: string,
  options: ActiveBinaryOptions = {},
): Promise<BinaryInfo | undefined> {
  const platform = resolvePlatform(options);
  const override = options.env?.CLOAKBROWSER_BINARY_PATH;
  if (override && (await usableBinary(override, platform))) {
    return {
      path: override,
      version: undefined,
      platform,
      pro: false,
      sha256: undefined,
      binarySha256: undefined,
      source: "custom",
      trust: "override",
    };
  }
  const pointerPath = join(root, "browser-runtime", "current.json");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(pointerPath, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    return undefined;
  }
  const parsed = pointerSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const pointer = parsed.data;
  const runtimeRoot = resolve(root, "browser-runtime");
  const suffix = relative(runtimeRoot, resolve(pointer.path));
  if (isAbsolute(suffix) || suffix === ".." || suffix.startsWith("../"))
    return undefined;
  if (!trustedSource(pointer.source, pointer.trust)) return undefined;
  if (!(await usableBinary(pointer.path, platform))) return undefined;
  if ((await fileHash(pointer.path)) !== pointer.binary_sha256)
    return undefined;
  return {
    path: pointer.path,
    version: pointer.version,
    platform,
    pro: pointer.pro,
    sha256: pointer.sha256,
    binarySha256: pointer.binary_sha256,
    source: pointer.source,
    trust: pointer.trust,
  };
}
