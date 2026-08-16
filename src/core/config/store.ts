import { open, readFile, rename, unlink } from "node:fs/promises";
import { basename, join, dirname } from "node:path";
import { BrowserLoginError } from "../../shared/errors";
import { posixPathSecurity, statePaths } from "./paths";
import type { PathSecurity } from "./paths";

export class ConfigCorruptError extends BrowserLoginError {
  constructor(message = "BrowserLogin configuration is corrupt", options?: ErrorOptions) {
    super(message, "CONFIG_CORRUPT", options);
  }
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "EISDIR" && code !== "ENOTSUP") throw error;
  }
}

async function privateFile(security: PathSecurity, path: string): Promise<void> {
  await security.rejectReparse?.(path);
  await security.verify(path, false);
}

function scrubCorrupt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubCorrupt);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) =>
        /api[_-]?key|license|secret|token|password/i.test(key)
          ? [key, "<redacted>"]
          : [key, scrubCorrupt(item)],
      ),
    );
  }
  return typeof value === "string" && /^(bl_|https?:\/\/)/i.test(value)
    ? "<redacted>"
    : value;
}

export async function atomicWriteJson(
  path: string,
  value: unknown,
  security: PathSecurity = posixPathSecurity(),
): Promise<void> {
  const parent = dirname(path);
  await security.rejectReparse?.(parent);
  const temporary = join(parent, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await security.rejectReparse?.(path);
    await rename(temporary, path);
    await syncDirectory(parent);
    await privateFile(security, path);
    JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function backupCorruptConfig(
  path: string,
  security: PathSecurity = posixPathSecurity(),
): Promise<void> {
  const backup = `${path}.bak`;
  try {
    await privateFile(security, path);
    const raw = await readFile(path, "utf8");
    let safe: unknown = { corrupt: true, code: "CONFIG_CORRUPT" };
    try {
      safe = scrubCorrupt(JSON.parse(raw));
    } catch {
      safe = { corrupt: true, code: "CONFIG_CORRUPT" };
    }
    await atomicWriteJson(backup, safe, security);
  } catch {
    return;
  }
}

export async function readJson<T>(
  path: string,
  security: PathSecurity = posixPathSecurity(),
): Promise<T | null> {
  try {
    await privateFile(security, path);
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function configStore(root: string, security: PathSecurity = posixPathSecurity()) {
  const paths = statePaths(root);
  return {
    paths,
    async read<T>(): Promise<T | null> {
      try {
        return await readJson<T>(paths.connection, security);
      } catch (error) {
        await backupCorruptConfig(paths.connection, security);
        throw new ConfigCorruptError(undefined, { cause: error });
      }
    },
    async write(value: unknown): Promise<void> {
      await atomicWriteJson(paths.connection, value, security);
    },
  };
}
