import { chmod, mkdir, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, platform as hostPlatform } from "node:os";
import { dirname, isAbsolute, join, resolve, win32 } from "node:path";

export const STATE_DIRECTORIES = [
  "state",
  "locks",
  "work",
  "artifacts",
  "cache",
  "browser-cache",
  "launch",
  "gates",
  "controls",
  "ready",
  "logs",
] as const;

export type StateDirectory = (typeof STATE_DIRECTORIES)[number];
export type SupportedPlatform = "darwin" | "win32" | "linux";

export type StatePathOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: string;
  home?: string;
  appData?: string;
  localAppData?: string;
};

export type StatePaths = {
  root: string;
  [key: string]: string;
};

function requireAbsolute(value: string, name: string, platform?: string): string {
  const pathApi = platform === "win32" ? win32 : { isAbsolute, resolve };
  if (!pathApi.isAbsolute(value)) throw new TypeError(`${name} must be absolute`);
  return pathApi.resolve(value);
}

export function resolveStateRoot(options: StatePathOptions = {}): string {
  const env = options.env ?? process.env;
  const override = env.BROWSERLOGIN_STATE_DIR;
  if (override !== undefined && override !== "") {
    return requireAbsolute(override, "BROWSERLOGIN_STATE_DIR");
  }

  const platform = options.platform ?? hostPlatform();
  const home = requireAbsolute(options.home ?? env.HOME ?? homedir(), "home", platform);
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "BrowserLogin");
  }
  if (platform === "win32") {
    const appData = options.appData ?? env.APPDATA;
    const localAppData = options.localAppData ?? env.LOCALAPPDATA;
    return win32.join(
      requireAbsolute(appData ?? localAppData ?? win32.join(home, "AppData", "Roaming"), "Windows app data", platform),
      "BrowserLogin",
    );
  }
  const xdgState = env.XDG_STATE_HOME;
  return join(
    requireAbsolute(xdgState ?? join(home, ".local", "state"), "XDG_STATE_HOME"),
    "browserlogin",
  );
}

export function statePaths(root: string): StatePaths {
  const absoluteRoot = requireAbsolute(root, "state root");
  return Object.fromEntries([
    ["root", absoluteRoot],
    ...STATE_DIRECTORIES.map((name) => [name, join(absoluteRoot, name)]),
    ["connection", join(absoluteRoot, "connection.json")],
    ["connectionBackup", join(absoluteRoot, "connection.json.bak")],
    ["connectionPending", join(absoluteRoot, "connection.pending.json")],
  ]) as StatePaths;
}

async function rejectReparse(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`reparse point: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export type PathSecurity = {
  secure(path: string, directory: boolean): Promise<void> | void;
  verify(path: string, directory: boolean): Promise<void> | void;
  rejectReparse?(path: string): Promise<void> | void;
};

export function posixPathSecurity(): PathSecurity {
  return {
    async secure(path, directory) {
      await chmod(path, directory ? 0o700 : 0o600);
    },
    async verify(path, directory) {
      const info = await lstat(path);
      if ((directory ? !info.isDirectory() : !info.isFile()) || info.isSymbolicLink()) {
        throw new Error("private path has an invalid type");
      }
      if ((info.mode & 0o077) !== 0) throw new Error("private path is not private");
      if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
        throw new Error("private path is not owned by the current user");
      }
    },
    rejectReparse,
  };
}

export type WindowsAclCommand = {
  applyCurrentUserAcl(path: string, directory: boolean): Promise<void> | void;
  verifyCurrentUserAcl(path: string, directory: boolean): Promise<void> | void;
};

export function windowsPathSecurity(acl: WindowsAclCommand): PathSecurity {
  return {
    async secure(path, directory) {
      await acl.applyCurrentUserAcl(path, directory);
    },
    async verify(path, directory) {
      await acl.verifyCurrentUserAcl(path, directory);
    },
    rejectReparse,
  };
}

export async function ensureStatePaths(
  paths: StatePaths,
  security: PathSecurity = posixPathSecurity(),
): Promise<void> {
  const root = paths.root;
  if (!isAbsolute(root)) throw new TypeError("state root must be absolute");
  await security.rejectReparse?.(dirname(root));
  await mkdir(root, { recursive: true, mode: 0o700 });
  await security.rejectReparse?.(root);
  await security.secure(root, true);
  await security.verify(root, true);
  for (const name of STATE_DIRECTORIES) {
    const directory = paths[name];
    await security.rejectReparse?.(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await security.secure(directory, true);
    await security.verify(directory, true);
  }
}

export const PRIVATE_MODE = constants.S_IRUSR | constants.S_IWUSR;
