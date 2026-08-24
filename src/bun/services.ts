import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserLoginClient } from "../core/api/client.js";
import {
  createApplicationRuntime,
  type ApplicationRuntime,
} from "../core/app/index.js";
import type { ensureBinary, readActiveBinary } from "../core/binary/index.js";
import type { ConnectionStore } from "../core/config/connection.js";
import { statePaths } from "../core/config/paths.js";
import type { LifecycleOperations } from "../core/app/sessions.js";
import type { KeychainFacade } from "../core/keychain/index.js";
import { AppRPCSchemas } from "../shared/rpc-schema.js";
import type { AppServices, BinaryProgress } from "./rpc.js";
import type { UpdateController } from "./updater.js";

export type AppServiceContext = {
  readonly root: string;
  readonly connection: ConnectionStore;
  readonly keychain: KeychainFacade;
  readonly updateController: UpdateController;
  readonly emitProgress: (progress: BinaryProgress) => void;
  readonly installCli?: () => Promise<{
    readonly installed: boolean;
    readonly path?: string;
    readonly message: string;
  }>;
  readonly client?: BrowserLoginClient;
  readonly coordinator?: LifecycleOperations;
  readonly ensureBinary?: typeof ensureBinary;
  readonly readActiveBinary?: typeof readActiveBinary;
};

async function tailLog(root: string, lines: number): Promise<string[]> {
  const path = join(statePaths(root).logs, "mcp.log");
  const text = await readFile(path, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    },
  );
  return text.split(/\r?\n/).filter(Boolean).slice(-lines);
}

function adapterServices(
  runtime: ApplicationRuntime,
  context: AppServiceContext,
): AppServices {
  return {
    ...runtime.services,
    updatesCheck: async () => context.updateController.checkForUpdate(),
    updatesDownload: async () => context.updateController.downloadUpdate(),
    updatesApply: async (raw: unknown) => {
      const input = AppRPCSchemas.updatesApply.params.parse(raw);
      return context.updateController.applyAfterConfirmation(input.confirmed);
    },
    cliInstall: async () =>
      context.installCli?.() ?? {
        installed: false,
        message:
          "CLI installation becomes available with the browserlogin CLI build.",
      },
    logsTail: async (raw: unknown) => {
      const input = AppRPCSchemas.logsTail.params.parse(raw);
      return { lines: await tailLog(context.root, input.lines) };
    },
  };
}

export function createCoreAppRuntime(context: AppServiceContext): {
  readonly services: AppServices;
  readonly recover: () => Promise<void>;
  readonly application: ApplicationRuntime;
} {
  const application = createApplicationRuntime({
    root: context.root,
    connection: context.connection,
    keychain: context.keychain,
    progress: context.emitProgress,
    ...(context.client ? { client: context.client } : {}),
    ...(context.coordinator ? { coordinator: context.coordinator } : {}),
    ...(context.ensureBinary ? { ensureBinary: context.ensureBinary } : {}),
    ...(context.readActiveBinary
      ? { readActiveBinary: context.readActiveBinary }
      : {}),
  });
  return {
    services: adapterServices(application, context),
    recover: application.recover,
    application,
  };
}

export function createCoreAppServices(context: AppServiceContext): AppServices {
  return createCoreAppRuntime(context).services;
}
