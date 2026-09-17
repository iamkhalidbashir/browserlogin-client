import { accessSync, constants as fsConstants } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SAFE_PARENT_ENV = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LANGUAGE",
  "TZ",
] as const;

const SENSITIVE_ENV =
  /(api[_-]?key|license|proxy|token|secret|password|credential|auth)/i;

export type VendorCommandOptions = {
  readonly nodeCommand?: string;
};

export type VendorCommandEnvironment = {
  readonly env: NodeJS.ProcessEnv;
  readonly execPath: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly moduleDir: string;
  readonly available: (path: string) => boolean;
  readonly executable: (path: string) => boolean;
};

const available = (path: string): boolean => {
  try {
    accessSync(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const executable = (path: string): boolean => {
  try {
    accessSync(
      path,
      process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
};

const currentEnvironment = (): VendorCommandEnvironment => ({
  env: process.env,
  execPath: process.execPath,
  argv: process.argv,
  cwd: process.cwd(),
  moduleDir: import.meta.dir,
  available,
  executable,
});

export const childEnv = (
  extraEnv: Record<string, string> = {},
): Record<string, string> => {
  for (const key of Object.keys(extraEnv)) {
    if (SENSITIVE_ENV.test(key))
      throw new Error("unsafe child environment key");
  }
  const selected = Object.fromEntries(
    SAFE_PARENT_ENV.flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key] as string]],
    ),
  );
  return {
    ...selected,
    PWTEST_SOCKETS_DIR:
      process.env.PWTEST_SOCKETS_DIR ??
      (process.platform === "win32" ? (process.env.TEMP ?? ".") : "/tmp"),
    ...extraEnv,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
  };
};

export const redactStderr = (text: string): string =>
  text
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(
      /(token|secret|password|api[_-]?key)\s*[=:]\s*[^\s]+/gi,
      "$1=[REDACTED]",
    );

export const resolveCliPath = (): string =>
  fileURLToPath(new URL("./vendor-entry.cjs", import.meta.url));

export const vendorHelperName = (): string => {
  if (process.platform === "darwin" && process.arch === "arm64")
    return "browserlogin-browser-tools-macos-arm64";
  if (process.platform === "linux" && process.arch === "x64")
    return "browserlogin-browser-tools-linux-x64";
  if (process.platform === "win32" && process.arch === "x64")
    return "browserlogin-browser-tools-windows-x64.exe";
  throw new Error("browser tools helper platform is unsupported");
};

export const vendorScriptPath = (): string =>
  join("browserlogin-browser-tools-runtime", "vendor-entry.js");

export const vendorOutputDirectory = (
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const home = env.HOME ?? env.USERPROFILE;
  if (!home) throw new Error("user home directory is unavailable");
  return join(home, "Downloads");
};

export const resolveVendorCommand = (
  options: VendorCommandOptions,
  cliPath: string,
  environment: VendorCommandEnvironment = currentEnvironment(),
): { command: string; prefix: string[] } => {
  if (options.nodeCommand)
    return { command: options.nodeCommand, prefix: [cliPath] };
  const explicitHelper = environment.env.BROWSERLOGIN_BROWSER_TOOLS_HELPER;
  if (explicitHelper) {
    if (!environment.executable(explicitHelper))
      throw new Error("packaged browser tools helper is unavailable");
    return { command: explicitHelper, prefix: [] };
  }
  const name = vendorHelperName();
  if (/^bun(?:\.exe)?$/i.test(basename(environment.execPath))) {
    const script = join(
      environment.moduleDir,
      "..",
      "vendor",
      vendorScriptPath(),
    );
    if (environment.available(script))
      return { command: environment.execPath, prefix: [script] };
    return {
      command: environment.env.BROWSERLOGIN_NODE_PATH ?? "node",
      prefix: [cliPath],
    };
  }
  const electrobunHelper = join(environment.moduleDir, "..", "vendor", name);
  if (environment.executable(electrobunHelper))
    return { command: electrobunHelper, prefix: [] };
  const candidates = [
    join(dirname(environment.execPath), name),
    environment.argv[1]
      ? join(dirname(environment.argv[1]), "vendor", name)
      : undefined,
    join(environment.moduleDir, "vendor", name),
    join(environment.cwd, "dist", "vendor", name),
  ].filter((value): value is string => Boolean(value));
  const helper = candidates.find(environment.executable);
  if (!helper) throw new Error("packaged browser tools helper is unavailable");
  return { command: helper, prefix: [] };
};
