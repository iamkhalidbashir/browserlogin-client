import type { RuntimePool } from "./runtime-pool";

export type CoordinatorStop = (profileId: string) => Promise<unknown>;

export class BrowserToolsLifecycle {
  constructor(
    private readonly pool: RuntimePool,
    private readonly coordinatorStop: CoordinatorStop,
  ) {}

  async stop(profileId: string): Promise<unknown> {
    try {
      return await this.coordinatorStop(profileId);
    } finally {
      await this.pool.closeProfile(profileId);
    }
  }

  async shutdown(): Promise<void> {
    await this.pool.closeAll();
  }
}

export const coordinatorRuntimeStopHook =
  (pool: RuntimePool) =>
  async (profileId: string): Promise<void> => {
    await pool.closeProfile(profileId);
  };
