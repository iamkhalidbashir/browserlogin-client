import type { BrowserLoginClient } from "../api/client.js";
import { ensureBinary, readActiveBinary } from "../binary/index.js";
import type { ConnectionStore } from "../config/connection.js";
import type { KeychainFacade } from "../keychain/index.js";
import { AppRPCSchemas } from "../../shared/rpc-schema.js";
import { createApiServices } from "./api-services.js";
import { ApplicationBinary, type BinaryProgress } from "./binary.js";
import { ApplicationClient, type ApplicationConnection } from "./client.js";
import {
  executeApplication,
  type ApplicationResult,
  type ApplicationServices,
} from "./contracts.js";
import { createConfigurationServices } from "./configuration-services.js";
import { ApplicationSessions, type LifecycleOperations } from "./sessions.js";
import type { RecoveryState } from "../coordinator/state.js";
import type { Session } from "../../shared/api-types.js";

export type ApplicationRuntimeOptions = {
  readonly root: string;
  readonly connection: ConnectionStore;
  readonly keychain: KeychainFacade;
  readonly progress?: (progress: BinaryProgress) => void;
  readonly client?: BrowserLoginClient;
  readonly coordinator?: LifecycleOperations;
  readonly ensureBinary?: typeof ensureBinary;
  readonly readActiveBinary?: typeof readActiveBinary;
};

export type ApplicationLifecycle = {
  start(profileId: string): Promise<ApplicationResult<RecoveryState>>;
  stop(profileId: string): Promise<ApplicationResult<Session>>;
  forceStop(profileId: string): Promise<ApplicationResult<Session>>;
};

export type ApplicationRuntime = {
  readonly services: ApplicationServices;
  readonly lifecycle: ApplicationLifecycle;
  readonly binary: ApplicationBinary;
  recover(): Promise<void>;
  remoteConnection(): Promise<ApplicationConnection>;
  loadSessionState(profileId: string): Promise<RecoveryState | null>;
  setRuntimeStop(stop: (profileId: string) => Promise<void>): void;
  close(): Promise<void>;
};

export function createApplicationRuntime(
  options: ApplicationRuntimeOptions,
): ApplicationRuntime {
  const client = new ApplicationClient(options.connection, options.client);
  const sessions = new ApplicationSessions({
    root: options.root,
    client: () => client.client(),
    ...(options.coordinator ? { coordinator: options.coordinator } : {}),
  });
  const binary = new ApplicationBinary({
    root: options.root,
    keychain: options.keychain,
    ...(options.progress ? { progress: options.progress } : {}),
    ...(options.ensureBinary ? { initializeBinary: options.ensureBinary } : {}),
    ...(options.readActiveBinary
      ? { activeBinary: options.readActiveBinary }
      : {}),
  });
  const services: ApplicationServices = {
    ...createConfigurationServices({
      root: options.root,
      connection: options.connection,
      keychain: options.keychain,
      client,
      invalidateSessions: () => sessions.invalidate(),
    }),
    ...createApiServices(() => client.client()),
    sessionsStart: async (raw) => {
      const input = AppRPCSchemas.sessionsStart.params.parse(raw);
      return sessions.start(input.profileId);
    },
    sessionsStop: async (raw) => {
      const input = AppRPCSchemas.sessionsStop.params.parse(raw);
      return sessions.stop(input.profileId);
    },
    sessionsForceStop: async (raw) => {
      const input = AppRPCSchemas.sessionsForceStop.params.parse(raw);
      return sessions.forceStop(input.profileId, input.confirmation);
    },
    sessionsLive: async () => sessions.listLive(),
    binaryStatus: async () => binary.status(),
    binaryDownload: async (raw) =>
      binary.download(AppRPCSchemas.binaryDownload.params.parse(raw)),
    binaryProgress: async () => binary.currentProgress(),
  };
  const lifecycle: ApplicationLifecycle = {
    start: (profileId) => executeApplication(() => sessions.start(profileId)),
    stop: (profileId) => executeApplication(() => sessions.stop(profileId)),
    forceStop: (profileId) =>
      executeApplication(() => sessions.forceStop(profileId)),
  };
  return {
    services,
    lifecycle,
    binary,
    recover: () => sessions.recover(),
    remoteConnection: () => client.remoteConnection(),
    loadSessionState: (profileId) => sessions.loadState(profileId),
    setRuntimeStop: (stop) => sessions.setRuntimeStop(stop),
    close: async () => undefined,
  };
}
