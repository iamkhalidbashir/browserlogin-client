import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { join, relative } from "node:path";
import { atomicWriteJson } from "../config/store.js";
import { SafeZipArchive } from "../archive/index.js";
import {
  BinaryManagerError,
  type BinaryInfo,
  type InstallOptions,
} from "./types.js";

type Pointer = {
  version: string;
  pro: boolean;
  path: string;
  installed_at: string;
  sha256: string;
  source: "official" | "custom";
  trust: "verified" | "unverified-custom";
  binary_sha256: string;
};

async function findExecutable(root: string): Promise<string | undefined> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const found = await findExecutable(path);
      if (found) return found;
    } else if (
      entry.isFile() &&
      /^(?:chrome|chromium|cloakbrowser)(?:\.exe)?$/i.test(entry.name)
    )
      return path;
  }
  return undefined;
}

async function executable(path: string, platform: string): Promise<boolean> {
  const info = await lstat(path).catch(() => undefined);
  return Boolean(
    info?.isFile() && (platform === "windows-x64" || (info.mode & 0o111) !== 0),
  );
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function makeExecutable(root: string, platform: string): Promise<void> {
  if (platform === "windows-x64") return;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await makeExecutable(path, platform);
    else if (
      entry.isFile() &&
      /^(?:chrome|chromium|cloakbrowser)$/i.test(entry.name)
    )
      await chmod(path, 0o700);
  }
}

function tarName(block: Buffer): string {
  return block.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
}

function tarNumber(block: Buffer, offset: number, length: number): number {
  const value = block
    .subarray(offset, offset + length)
    .toString("ascii")
    .replace(/\0.*$/, "")
    .trim();
  return value ? Number.parseInt(value, 8) : 0;
}

async function extractTarGz(
  archive: string,
  destination: string,
): Promise<void> {
  let buffered = Buffer.alloc(0);
  const output = new Map<
    string,
    { handle: Awaited<ReturnType<typeof open>>; remaining: number }
  >();
  let current: { name: string; size: number; mode: number } | undefined;
  const stream = createReadStream(archive).pipe(createGunzip());
  for await (const chunk of stream) {
    buffered = Buffer.concat([buffered, Buffer.from(chunk)]);
    while (true) {
      if (!current) {
        if (buffered.length < 512) break;
        const header = buffered.subarray(0, 512);
        buffered = buffered.subarray(512);
        if (header.every((byte) => byte === 0)) break;
        const type = String.fromCharCode(header[156] ?? 0);
        if (type !== "0" && type !== "\0" && type !== "5")
          throw new Error("tar symlink or special entry rejected");
        const name = tarName(header).replaceAll("\\", "/");
        if (
          !name ||
          name.split("/").some((part) => part === "..") ||
          name.startsWith("/")
        )
          throw new Error("unsafe tar path");
        const size = tarNumber(header, 124, 12);
        const mode = tarNumber(header, 100, 8);
        if (type === "5") {
          await mkdir(
            join(destination, ...name.replace(/\/$/, "").split("/")),
            { recursive: true, mode: 0o700 },
          );
          continue;
        }
        const path = join(destination, ...name.split("/"));
        await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
        const handle = await open(path, "wx", 0o600);
        output.set(name, { handle, remaining: size });
        current = { name, size, mode };
      }
      if (!current) continue;
      const state = output.get(current.name)!;
      const count = Math.min(buffered.length, state.remaining);
      if (count) {
        await state.handle.write(buffered.subarray(0, count));
        buffered = buffered.subarray(count);
        state.remaining -= count;
      }
      if (state.remaining) break;
      await state.handle.close();
      if (process.platform !== "win32")
        await chmod(
          join(destination, ...current.name.split("/")),
          current.mode & 0o777 || 0o600,
        );
      output.delete(current.name);
      const padding = (512 - (current.size % 512)) % 512;
      if (buffered.length < padding) break;
      buffered = buffered.subarray(padding);
      current = undefined;
    }
  }
  if (current || output.size) throw new Error("truncated tar archive");
}

async function retainVersions(root: string, current: string): Promise<void> {
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== ".staging")
    .sort((a, b) => a.name.localeCompare(b.name));
  const removable = entries
    .filter((entry) => entry.name !== current)
    .slice(0, Math.max(0, entries.length - 3));
  for (const entry of removable)
    await rm(join(root, entry.name), { recursive: true, force: true });
}

export async function installBinary(
  options: InstallOptions,
): Promise<BinaryInfo> {
  const runtime = join(options.root, "browser-runtime");
  const browsers = join(runtime, "browsers");
  const name = `${options.platform}-${options.version}${options.pro ? "-pro" : ""}`;
  const destination = join(browsers, name);
  const staging = join(browsers, `.staging-${process.pid}-${Date.now()}`);
  await mkdir(browsers, { recursive: true, mode: 0o700 });
  try {
    if (options.archive.endsWith(".tar.gz"))
      await extractTarGz(options.archive, staging);
    else await new SafeZipArchive().extractAtomic(options.archive, staging);
    await makeExecutable(staging, options.platform);
    const binaryPath = await findExecutable(staging);
    if (!binaryPath || !(await executable(binaryPath, options.platform)))
      throw new Error(
        "installed archive contains no executable CloakBrowser binary",
      );
    const backup = `${destination}.previous`;
    const pointerPath = join(runtime, "current.json");
    const previousPointer = await readFile(pointerPath, "utf8").catch(
      () => undefined,
    );
    await rm(backup, { recursive: true, force: true });
    const previousDestination = await lstat(destination).catch(() => undefined);
    if (previousDestination) await rename(destination, backup);
    await rename(staging, destination);
    const installedPath = join(destination, relative(staging, binaryPath));
    const binarySha256 = await sha256File(installedPath);
    const pointer: Pointer = {
      version: options.version,
      pro: options.pro,
      path: installedPath,
      installed_at: new Date().toISOString(),
      sha256: options.sha256,
      source: options.source,
      trust: options.trust,
      binary_sha256: binarySha256,
    };
    await atomicWriteJson(join(runtime, "current.json"), pointer);
    const info: BinaryInfo = {
      path: installedPath,
      version: options.version,
      platform: options.platform,
      pro: options.pro,
      sha256: options.sha256,
      source: options.source,
      trust: options.trust,
      binarySha256,
    };
    if (options.healthCallback && !(await options.healthCallback(info))) {
      await rm(destination, { recursive: true, force: true });
      if (previousDestination) await rename(backup, destination);
      if (previousPointer === undefined) await rm(pointerPath, { force: true });
      else await atomicWriteJson(pointerPath, JSON.parse(previousPointer));
      throw new Error(
        "CloakBrowser health callback rejected the installed runtime",
      );
    }
    await rm(backup, { recursive: true, force: true });
    await retainVersions(browsers, name);
    return info;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (error instanceof BinaryManagerError) throw error;
    throw new BinaryManagerError(
      "CloakBrowser runtime installation failed",
      "INSTALL_FAILED",
      { cause: error },
    );
  }
}

export async function installedBinary(
  root: string,
  version: string,
  pro: boolean,
  platform?: string,
): Promise<BinaryInfo | undefined> {
  const path = join(
    root,
    "browser-runtime",
    "browsers",
    `${platform ?? (process.platform === "win32" ? "windows-x64" : "linux-x64")}-${version}${pro ? "-pro" : ""}`,
  );
  const binary = await findExecutable(path).catch(() => undefined);
  if (
    !binary ||
    !(await executable(
      binary,
      platform ?? (process.platform === "win32" ? "windows-x64" : "linux-x64"),
    ))
  )
    return undefined;
  let metadata: Partial<Pointer> = {};
  try {
    const pointer = JSON.parse(
      await readFile(join(root, "browser-runtime", "current.json"), "utf8"),
    ) as Partial<Pointer>;
    if (
      pointer.path === binary &&
      pointer.version === version &&
      pointer.pro === pro
    )
      metadata = pointer;
  } catch {
    metadata = {};
  }
  return {
    path: binary,
    version,
    platform: undefined,
    pro,
    sha256: undefined,
    source: metadata.source ?? "official",
    trust: metadata.trust ?? "verified",
    binarySha256: metadata.binary_sha256,
  };
}
