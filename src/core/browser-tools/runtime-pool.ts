import type {
  VendorBrowserRuntime,
  VendorBrowserRuntimeFactory,
} from "./types";

type ProfileState = {
  runtime?: VendorBrowserRuntime;
  startup?: Promise<VendorBrowserRuntime>;
  tail: Promise<void>;
};

export class RuntimePool {
  private readonly profiles = new Map<string, ProfileState>();
  private shutdownHandler?: () => void;

  constructor(private readonly factory: VendorBrowserRuntimeFactory) {}

  private state(profileId: string): ProfileState {
    const current = this.profiles.get(profileId);
    if (current) return current;
    const created: ProfileState = { tail: Promise.resolve() };
    this.profiles.set(profileId, created);
    return created;
  }

  private async runtime(
    profileId: string,
    relayCdpUrl: string,
  ): Promise<VendorBrowserRuntime> {
    const state = this.state(profileId);
    if (state.runtime) return state.runtime;
    if (!state.startup) {
      state.startup = this.factory(profileId, relayCdpUrl).then(
        (runtime) => {
          state.runtime = runtime;
          state.startup = undefined;
          return runtime;
        },
        (error) => {
          state.startup = undefined;
          if (!state.runtime) this.profiles.delete(profileId);
          throw error;
        },
      );
    }
    return state.startup;
  }

  async call<T>(
    profileId: string,
    relayCdpUrl: string,
    operation: (runtime: VendorBrowserRuntime) => Promise<T>,
  ): Promise<T> {
    const state = this.state(profileId);
    const previous = state.tail;
    let release!: () => void;
    state.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation(await this.runtime(profileId, relayCdpUrl));
    } finally {
      release();
    }
  }

  async closeProfile(profileId: string): Promise<void> {
    const state = this.profiles.get(profileId);
    if (!state) return;
    await state.tail;
    const runtime = state.runtime;
    this.profiles.delete(profileId);
    if (runtime) await runtime.close();
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.profiles.keys()].map((profileId) =>
        this.closeProfile(profileId),
      ),
    );
  }

  installProcessShutdownHooks(
    target: Pick<NodeJS.Process, "once"> = process,
  ): () => Promise<void> {
    if (this.shutdownHandler) return async () => this.closeAll();
    this.shutdownHandler = () => {
      void this.closeAll();
    };
    target.once("SIGINT", this.shutdownHandler);
    target.once("SIGTERM", this.shutdownHandler);
    target.once("beforeExit", this.shutdownHandler);
    return async () => this.closeAll();
  }

  get size(): number {
    return this.profiles.size;
  }
}
