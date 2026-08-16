import { constants } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { posixPathSecurity, type PathSecurity } from "../config/paths.js";
import type { LaunchSpec } from "./types.js";

const FIELDS = [
  "profile_id",
  "seed",
  "platform",
  "geoip",
  "humanize",
  "human_preset",
  "bumblebee_profile",
  "headless",
  "timezone",
  "locale",
  "user_agent",
  "viewport",
  "args",
  "user_data_dir",
  "browser_cache_dir",
  "browser_cache_max_bytes",
  "proxy",
] as const;

const protectedNames = [
  "--user-data-dir",
  "--disk-cache-dir",
  "--disk-cache-size",
  "--remote-debugging-port",
  "--remote-debugging-address",
  "--remote-debugging-host",
  "--remote-debugging-pipe",
  "--fingerprint",
  "--fingerprint-platform",
  "--no-sandbox",
  "--disable-setuid-sandbox",
] as const;

const nonEmpty = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${name} is invalid`);
  return value;
};

const nullableString = (value: unknown, name: string): string | null => {
  if (value !== null && typeof value !== "string")
    throw new Error(`${name} is invalid`);
  return value;
};

const boolean = (value: unknown, name: string): boolean => {
  if (typeof value !== "boolean") throw new Error(`${name} is invalid`);
  return value;
};

const integer = (value: unknown, name: string, minimum = 0): number => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  )
    throw new Error(`${name} is invalid`);
  return value;
};

const validateProxy = (value: unknown): LaunchSpec["proxy"] => {
  if (value === null) return null;
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).sort().join(",") !==
      "host,password,port,protocol,username"
  )
    throw new Error("proxy is invalid");
  const proxy = value as Record<string, unknown>;
  const protocol = nonEmpty(proxy.protocol, "proxy.protocol").toLowerCase();
  if (!["http", "https", "socks4", "socks5"].includes(protocol))
    throw new Error("proxy.protocol is invalid");
  const host = nonEmpty(proxy.host, "proxy.host");
  const port = integer(proxy.port, "proxy.port", 1);
  if (port > 65535) throw new Error("proxy.port is invalid");
  const username = nullableString(proxy.username, "proxy.username");
  const password = nullableString(proxy.password, "proxy.password");
  return { protocol, host, port, username, password };
};

export function validateLaunchSpec(value: unknown): LaunchSpec {
  if (!value || typeof value !== "object")
    throw new Error("launch spec is invalid");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== [...FIELDS].sort().join(","))
    throw new Error("launch spec contains unknown or missing fields");
  const platform = record.platform;
  if (platform !== "macos" && platform !== "linux" && platform !== "windows")
    throw new Error("platform is invalid");
  const humanPreset = record.human_preset;
  if (humanPreset !== "default" && humanPreset !== "careful")
    throw new Error("human_preset is invalid");
  const bumblebee = record.bumblebee_profile;
  if (
    !["default", "precise", "fast", "natural", "messy"].includes(
      String(bumblebee),
    )
  )
    throw new Error("bumblebee_profile is invalid");
  if (
    !Array.isArray(record.args) ||
    record.args.some((arg) => typeof arg !== "string")
  )
    throw new Error("args is invalid");
  const viewport = record.viewport;
  if (viewport !== null) {
    if (
      !viewport ||
      typeof viewport !== "object" ||
      Object.keys(viewport).sort().join(",") !== "height,width"
    )
      throw new Error("viewport is invalid");
    integer((viewport as Record<string, unknown>).width, "viewport.width", 1);
    integer((viewport as Record<string, unknown>).height, "viewport.height", 1);
  }
  const cacheMax = integer(
    record.browser_cache_max_bytes,
    "browser_cache_max_bytes",
    1,
  );
  return {
    profile_id: nonEmpty(record.profile_id, "profile_id"),
    seed: integer(record.seed, "seed"),
    platform,
    geoip: boolean(record.geoip, "geoip"),
    humanize: boolean(record.humanize, "humanize"),
    human_preset: humanPreset,
    bumblebee_profile: bumblebee as LaunchSpec["bumblebee_profile"],
    headless: boolean(record.headless, "headless"),
    timezone: nullableString(record.timezone, "timezone"),
    locale: nullableString(record.locale, "locale"),
    user_agent: nullableString(record.user_agent, "user_agent"),
    viewport: viewport as LaunchSpec["viewport"],
    args: [...(record.args as string[])],
    user_data_dir: nonEmpty(record.user_data_dir, "user_data_dir"),
    browser_cache_dir: nonEmpty(record.browser_cache_dir, "browser_cache_dir"),
    browser_cache_max_bytes: cacheMax,
    proxy: validateProxy(record.proxy),
  };
}

export function protectedLaunchArgs(spec: LaunchSpec): string[] {
  for (const arg of spec.args) {
    if (
      protectedNames.some((name) => arg === name || arg.startsWith(`${name}=`))
    )
      throw new Error(
        "profile arguments cannot override protected browser flags",
      );
  }
  const args = [
    `--fingerprint=${spec.platform}`,
    ...(spec.platform === "windows" ? ["--fingerprint-platform=windows"] : []),
    `--disk-cache-dir=${spec.browser_cache_dir}`,
    `--disk-cache-size=${spec.browser_cache_max_bytes}`,
    ...spec.args,
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
  ];
  return args;
}

export async function createOneShotLaunchFile(
  path: string,
  spec: LaunchSpec,
  security: PathSecurity = posixPathSecurity(),
): Promise<void> {
  const validated = validateLaunchSpec(spec);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const fd = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600,
  );
  try {
    await fd.chmod(0o600);
    await fd.writeFile(JSON.stringify(validated), "utf8");
    await fd.sync();
    await fd.close();
    await security.verify(path, false);
  } catch (error) {
    await fd.close().catch(() => undefined);
    await unlink(path).catch(() => undefined);
    throw error;
  }
}

export async function readAndDeleteLaunchFile(
  path: string,
): Promise<LaunchSpec> {
  const fd = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let contents: string;
  try {
    const info = await fd.stat();
    if (!info.isFile()) throw new Error("launch file is not a regular file");
    contents = await fd.readFile("utf8");
  } finally {
    await fd.close();
  }
  await unlink(path);
  return validateLaunchSpec(JSON.parse(contents) as unknown);
}
