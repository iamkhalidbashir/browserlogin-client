import { BrowserToolsLifecycle, coordinatorRuntimeStopHook } from "./lifecycle";
import { ProfileResolver, type RunningProfileLookup } from "./resolver";
import { BrowserToolsRouter } from "./router";
import { RuntimePool } from "./runtime-pool";
import { createF2VendorRuntime } from "./vendor";
import type { VendorBrowserRuntimeFactory } from "./types";

export type BrowserToolsFactoryOptions = {
  lookup: RunningProfileLookup;
  coordinatorStop: (profileId: string) => Promise<unknown>;
  vendorFactory?: VendorBrowserRuntimeFactory;
  processTarget?: Pick<NodeJS.Process, "once">;
};

export function createBrowserTools(options: BrowserToolsFactoryOptions) {
  const pool = new RuntimePool(
    options.vendorFactory ??
      ((profileId, relayCdpUrl) =>
        createF2VendorRuntime({ profileId, relayCdpUrl })),
  );
  const lifecycle = new BrowserToolsLifecycle(pool, options.coordinatorStop);
  pool.installProcessShutdownHooks(options.processTarget ?? process);
  return {
    pool,
    lifecycle,
    router: new BrowserToolsRouter(
      new ProfileResolver(options.lookup),
      pool,
      lifecycle,
    ),
    runtimeStop: coordinatorRuntimeStopHook(pool),
  };
}
