import { basename } from "node:path";
import type { ApplicationServices } from "../core/app/contracts.js";
import { resolveStateRoot } from "../core/config/paths.js";
import {
  createServices,
  defaultIO,
  installCli,
  parse,
  portAvailable,
  profileRows,
  service,
  stableJson,
  usage,
  type CliIO,
} from "./support.js";

export type { CliIO } from "./support.js";

export type CliOptions = {
  services?: ApplicationServices;
  root?: string;
  io?: CliIO;
  executable?: string;
  runMcp?: () => Promise<void>;
};

export async function runCli(
  argv: readonly string[],
  options: CliOptions = {},
): Promise<number> {
  let parsed;
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
      const result = await installCli(options.executable ?? process.execPath);
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
