import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import type { ApplicationServices } from "../core/app/contracts.js";
import { vendorHelperName } from "../core/browser-tools/vendor.js";

export type CliIO = {
  stdout(value: string): void;
  stderr(value: string): void;
  prompt(question: string): Promise<string>;
};

export type Parsed = {
  command: string[];
  json: boolean;
  verbose: boolean;
  stateDir?: string;
  yes: boolean;
  force: boolean;
  pro: boolean;
  apiKeyEnv: boolean;
};

export const defaultIO = (): CliIO => ({
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
  prompt: async (question) => {
    const terminal = createInterface({ input, output });
    try {
      return await terminal.question(question);
    } finally {
      terminal.close();
    }
  },
});

export function parse(argv: readonly string[]): Parsed {
  const command: string[] = [];
  let json = false;
  let verbose = false;
  let stateDir: string | undefined;
  let yes = false;
  let force = false;
  let pro = false;
  let apiKeyEnv = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === "--help") command.push("help");
    else if (value === "--json") json = true;
    else if (value === "--verbose") verbose = true;
    else if (value === "--yes") yes = true;
    else if (value === "--force") force = true;
    else if (value === "--pro") pro = true;
    else if (value === "--api-key-env") apiKeyEnv = true;
    else if (value === "--state-dir") {
      stateDir = argv[++index];
      if (!stateDir) throw new TypeError("--state-dir requires a path");
    } else if (value.startsWith("--")) {
      throw new TypeError(`unknown option: ${value}`);
    } else command.push(value);
  }
  return { command, json, verbose, stateDir, yes, force, pro, apiKeyEnv };
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function profileRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value))
    throw new TypeError("profiles response is invalid");
  return value.map((profile) => {
    const item = profile as {
      id?: unknown;
      name?: unknown;
      platform?: unknown;
      cloud?: Record<string, unknown>;
    };
    return {
      profile_id: item.id,
      name: item.name,
      platform: item.platform,
      archive_generation: item.cloud?.archive_generation ?? null,
      cloud_session: Boolean(item.cloud?.current_session_id),
    };
  });
}

export async function service(
  services: ApplicationServices,
  name: keyof ApplicationServices,
  params: unknown,
): Promise<unknown> {
  const operation = services[name];
  if (!operation)
    throw Object.assign(new Error(`${String(name)} is unavailable`), {
      code: "NOT_IMPLEMENTED",
    });
  return operation(params);
}

async function loadFixtureServices(): Promise<ApplicationServices | undefined> {
  if (process.env.BROWSERLOGIN_TEST_MODE !== "1") return undefined;
  const path = process.env.BROWSERLOGIN_CLI_FIXTURE;
  if (!path) return undefined;
  const fixture = JSON.parse(await readFile(path, "utf8")) as Record<
    string,
    unknown
  >;
  return new Proxy(
    {},
    {
      get: (_target, name) =>
        name === "then" ? undefined : async () => fixture[String(name)],
    },
  ) as ApplicationServices;
}

export async function createServices(
  root: string,
): Promise<ApplicationServices> {
  const fixture = await loadFixtureServices();
  if (fixture) return fixture;
  const [connectionModule, keychainModule, appModule, updaterModule] =
    await Promise.all([
      import("../core/config/connection.js"),
      import("../core/keychain/index.js"),
      import("../core/app/runtime.js"),
      import("../bun/updater.js"),
    ]);
  const { ConnectionStore } = connectionModule;
  const { createKeychainBackend } = keychainModule;
  const { createApplicationRuntime } = appModule;
  const { UpdateController } = updaterModule;
  const keychain = createKeychainBackend();
  const connection = new ConnectionStore(root, keychain);
  const runtime = createApplicationRuntime({ root, keychain, connection });
  const updateController = new UpdateController();
  return {
    ...runtime.services,
    updatesCheck: async () => updateController.checkForUpdate(),
  };
}

function defaultInstallDestination(): string {
  return platform() === "win32"
    ? join(
        process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
        "Programs",
        "browserlogin",
        "browserlogin.exe",
      )
    : join(homedir(), ".local", "bin", "browserlogin");
}

export async function installCli(
  executable: string,
  destination = defaultInstallDestination(),
): Promise<{
  installed: boolean;
  path?: string;
  message: string;
}> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
  await copyFile(executable, destination);
  const helperName = vendorHelperName();
  const helperDestination = join(dirname(destination), helperName);
  await copyFile(join(dirname(executable), helperName), helperDestination);
  if (platform() !== "win32")
    await Promise.all([
      chmod(destination, 0o755),
      chmod(helperDestination, 0o755),
    ]);
  return {
    installed: true,
    path: destination,
    message: `${destination}\n${JSON.stringify({ browserlogin: { type: "local", command: ["browserlogin", "mcp"], enabled: true } })}`,
  };
}

export async function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

export function usage(): string {
  return [
    "browserlogin profiles [--json]",
    "browserlogin start <profile_id>",
    "browserlogin stop <profile_id> [--force [--yes]]",
    "browserlogin mcp",
    "browserlogin setup [--api-key-env]",
    "browserlogin status [--json]",
    "browserlogin binary download [--pro]",
    "browserlogin doctor [--json]",
    "browserlogin install-cli",
  ].join("\n");
}
