import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, platform } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolveStateRoot } from "../core/config/paths.js";
import type { ApplicationServices } from "../core/app/contracts.js";

export type CliIO = {
  stdout(value: string): void;
  stderr(value: string): void;
  prompt(question: string): Promise<string>;
};

export type CliOptions = {
  services?: ApplicationServices;
  root?: string;
  io?: CliIO;
  executable?: string;
  runMcp?: () => Promise<void>;
};

type Parsed = {
  command: string[];
  json: boolean;
  verbose: boolean;
  stateDir?: string;
  yes: boolean;
  force: boolean;
  pro: boolean;
  apiKeyEnv: boolean;
};

const defaultIO = (): CliIO => {
  return {
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
  };
};

function parse(argv: readonly string[]): Parsed {
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

function stableJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function profileRows(value: unknown): Array<Record<string, unknown>> {
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

async function service(
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

async function createServices(root: string): Promise<ApplicationServices> {
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
  const runtime = createApplicationRuntime({
    root,
    keychain,
    connection,
  });
  const updateController = new UpdateController();
  return {
    ...runtime.services,
    updatesCheck: async () => updateController.checkForUpdate(),
  };
}

async function installCli(executable: string): Promise<{
  installed: boolean;
  path?: string;
  message: string;
}> {
  const destination =
    platform() === "win32"
      ? join(
          process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
          "Programs",
          "browserlogin",
          "browserlogin.exe",
        )
      : join(homedir(), ".local", "bin", "browserlogin");
  await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
  await copyFile(executable, destination);
  if (platform() !== "win32") await chmod(destination, 0o755);
  return {
    installed: true,
    path: destination,
    message: `${destination}\n${JSON.stringify({ browserlogin: { type: "local", command: ["browserlogin", "mcp"], enabled: true } })}`,
  };
}

async function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

function usage(): string {
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

export async function runCli(
  argv: readonly string[],
  options: CliOptions = {},
): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parse(argv);
  } catch (error) {
    (options.io ?? defaultIO()).stderr(
      `${error instanceof Error ? error.message : "invalid arguments"}\n`,
    );
    return 2;
  }
  const io = options.io ?? defaultIO();
  const root = options.root ?? parsed.stateDir ?? resolveStateRoot();
  const [command, subcommand] = parsed.command;
  if (!command || command === "help" || command === "--help") {
    io.stdout(`${usage()}\n`);
    return command ? 0 : 2;
  }
  if (command === "mcp") {
    const mcp = options.runMcp ?? (await import("../mcp/server.js")).main;
    await mcp();
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  }
  const services = options.services ?? (await createServices(root));
  try {
    if (command === "profiles") {
      const rows = profileRows(await service(services, "profilesList", {}));
      io.stdout(stableJson(rows));
      return 0;
    }
    if (command === "start") {
      if (!subcommand) throw new TypeError("start requires profile_id");
      let interrupted = false;
      const onInterrupt = () => {
        interrupted = true;
      };
      process.once("SIGINT", onInterrupt);
      try {
        const result = await service(services, "sessionsStart", {
          profileId: subcommand,
        });
        if (interrupted)
          await service(services, "sessionsStop", { profileId: subcommand });
        if (parsed.json) io.stdout(stableJson(result));
        else io.stdout(`Profile started: ${subcommand}\n`);
        return interrupted ? 3 : 0;
      } finally {
        process.removeListener("SIGINT", onInterrupt);
      }
    }
    if (command === "stop") {
      if (!subcommand) throw new TypeError("stop requires profile_id");
      if (parsed.yes && !parsed.force)
        throw new TypeError("--yes is valid only with --force");
      if (parsed.force) {
        const expected = `FORCE CLOSE ${subcommand}`;
        if (!parsed.yes && !options.io && !process.stdin.isTTY)
          throw new TypeError(
            "Force close requires --yes in a noninteractive terminal.",
          );
        const confirmation = parsed.yes
          ? expected
          : await io.prompt(`Type ${expected} to continue: `);
        if (confirmation !== expected)
          throw new TypeError("force-stop confirmation did not match");
        const result = await service(services, "sessionsForceStop", {
          profileId: subcommand,
          confirmation,
        });
        if (parsed.json) io.stdout(stableJson(result));
        else io.stdout(`Profile force closed: ${subcommand}\n`);
      } else {
        const result = await service(services, "sessionsStop", {
          profileId: subcommand,
        });
        if (parsed.json) io.stdout(stableJson(result));
        else io.stdout(`Profile stopped: ${subcommand}\n`);
      }
      return 0;
    }
    if (command === "setup") {
      if (parsed.apiKeyEnv) {
        io.stdout(
          "Set BROWSERLOGIN_API_KEY and optionally BROWSERLOGIN_BASE_URL (the HTTPS application origin) and CLOAKBROWSER_LICENSE_KEY.\n",
        );
        return 0;
      }
      const appOrigin = await io.prompt("BrowserLogin application origin: ");
      const apiKey = await io.prompt("BrowserLogin API key: ");
      await service(services, "connectionSet", { appOrigin, apiKey });
      io.stdout("BrowserLogin connection saved.\n");
      return 0;
    }
    if (command === "status") {
      const result = {
        sessions: await service(services, "sessionsLive", {}),
        binary: await service(services, "binaryStatus", {}),
        update: await service(services, "updatesCheck", {}),
      };
      io.stdout(stableJson(result));
      return 0;
    }
    if (command === "binary" && subcommand === "download") {
      io.stdout(
        stableJson(
          await service(services, "binaryDownload", {
            advancedEnabled: false,
            pro: parsed.pro,
          }),
        ),
      );
      return 0;
    }
    if (command === "doctor") {
      const checks = {
        connection: await service(services, "connectionGet", {}).then(
          () => "ok",
          () => "setup required",
        ),
        state_dir: root,
        relay_port_4290: (await portAvailable(4290)) ? "available" : "busy",
        remote_mcp: "derived from application origin",
      };
      io.stdout(stableJson(checks));
      return checks.connection === "ok" ? 0 : 2;
    }
    if (command === "install-cli") {
      const result = options.services
        ? await service(services, "cliInstall", {})
        : await installCli(options.executable ?? process.execPath);
      io.stdout(stableJson(result));
      return 0;
    }
    if (parsed.verbose)
      io.stderr(`Unknown command: ${parsed.command.join(" ")}\n`);
    io.stderr(`${usage()}\n`);
    return 2;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code === "SETUP_REQUIRED") {
      io.stderr("BrowserLogin connection setup is required\n");
      return 2;
    }
    const message =
      error instanceof TypeError
        ? error.message
        : command === "start" || command === "stop"
          ? "Lifecycle request could not be completed."
          : "BrowserLogin operation could not be completed.";
    io.stderr(`${message}\n`);
    return error instanceof TypeError ? 2 : 3;
  }
}

export async function main(): Promise<void> {
  process.exitCode = await runCli(process.argv.slice(2));
}

if (
  import.meta.main ||
  basename(process.argv[0] ?? "").startsWith("browserlogin") ||
  basename(process.argv[1] ?? "").startsWith("browserlogin")
)
  await main();
