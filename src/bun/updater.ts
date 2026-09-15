import type { Updater as ElectrobunUpdater } from "electrobun/main";

type UpdaterApi = typeof ElectrobunUpdater;
type UpdaterInfo = ReturnType<UpdaterApi["updateInfo"]>;

export const UPDATE_CHANNEL = "stable" as const;
export const RELEASE_PAGE =
  "https://github.com/iamkhalidbashir/browserlogin-client/releases";

export type UpdateState = {
  channel: typeof UPDATE_CHANNEL;
  updateAvailable: boolean;
  updateReady: boolean;
  version?: string;
  error?: string;
  fallbackUrl?: string;
};

export type UpdateControllerOptions = {
  openExternal?: (url: string) => boolean;
  check?: UpdaterApi["checkForUpdate"];
  download?: UpdaterApi["downloadUpdate"];
  apply?: UpdaterApi["applyUpdate"];
  info?: () => UpdaterInfo | Promise<UpdaterInfo>;
};

export class UpdateController {
  private readonly openExternal: (url: string) => boolean;
  private readonly check: UpdaterApi["checkForUpdate"];
  private readonly download: UpdaterApi["downloadUpdate"];
  private readonly apply: UpdaterApi["applyUpdate"];
  private readonly info: () => UpdaterInfo | Promise<UpdaterInfo>;
  private checkInFlight: Promise<UpdateState> | undefined;
  private latestCheckState: UpdateState | null = null;

  constructor(options: UpdateControllerOptions = {}) {
    this.openExternal =
      options.openExternal ??
      ((url) => {
        void import("electrobun/main").then(({ Utils }) =>
          Utils.openExternal(url),
        );
        return true;
      });
    this.check =
      options.check ??
      (async () => (await import("electrobun/main")).Updater.checkForUpdate());
    this.download =
      options.download ??
      (async () => (await import("electrobun/main")).Updater.downloadUpdate());
    this.apply =
      options.apply ??
      (async () => (await import("electrobun/main")).Updater.applyUpdate());
    this.info =
      options.info ??
      (() =>
        import("electrobun/main").then(({ Updater }) => Updater.updateInfo()));
  }

  async checkForUpdate(): Promise<UpdateState> {
    if (this.checkInFlight) return this.checkInFlight;
    const operation = this.runCheck();
    this.checkInFlight = operation;
    try {
      return this.remember(await operation);
    } finally {
      if (this.checkInFlight === operation) this.checkInFlight = undefined;
    }
  }

  async latestCheck(): Promise<UpdateState | null> {
    return this.checkInFlight ?? this.latestCheckState;
  }

  private async runCheck(): Promise<UpdateState> {
    try {
      const result = await this.check();
      if (result.error)
        return {
          channel: UPDATE_CHANNEL,
          updateAvailable: false,
          updateReady: false,
          error: "Update check failed",
        };
      return {
        channel: UPDATE_CHANNEL,
        updateAvailable: Boolean(result.updateAvailable),
        updateReady: Boolean(result.updateReady),
        version: result.version || undefined,
        fallbackUrl: result.updateAvailable ? RELEASE_PAGE : undefined,
      };
    } catch {
      return {
        channel: UPDATE_CHANNEL,
        updateAvailable: false,
        updateReady: false,
        error: "Update check failed",
      };
    }
  }

  async downloadUpdate(): Promise<UpdateState> {
    const checked = await this.checkForUpdate();
    if (checked.error || !checked.updateAvailable) return checked;
    try {
      await this.download();
      const info = await this.info();
      if (info.error)
        return this.remember({
          ...checked,
          updateReady: false,
          error: "Update download failed",
        });
      return this.remember({
        ...checked,
        updateReady: Boolean(info.updateReady),
      });
    } catch {
      return this.remember({
        ...checked,
        updateReady: false,
        error: "Update download failed",
      });
    }
  }

  async applyAfterConfirmation(confirmed: boolean): Promise<UpdateState> {
    if (!confirmed)
      return {
        channel: UPDATE_CHANNEL,
        updateAvailable: true,
        updateReady: Boolean((await this.info())?.updateReady),
        error: "explicit confirmation is required",
        fallbackUrl: RELEASE_PAGE,
      };
    try {
      await this.apply();
      const info = await this.info();
      if (info.error) return this.applyFailure();
      return this.remember({
        channel: UPDATE_CHANNEL,
        updateAvailable: true,
        updateReady: false,
      });
    } catch {
      return this.applyFailure();
    }
  }

  private applyFailure(): UpdateState {
    this.openExternal(RELEASE_PAGE);
    return this.remember({
      channel: UPDATE_CHANNEL,
      updateAvailable: true,
      updateReady: true,
      error: "Update could not be applied automatically.",
      fallbackUrl: RELEASE_PAGE,
    });
  }

  private remember(state: UpdateState): UpdateState {
    this.latestCheckState = state;
    return state;
  }
}

export function installLaunchUpdateCheck(
  notify: (state: UpdateState) => void,
  controller = new UpdateController(),
  enabled = true,
): () => void {
  if (!enabled) return () => undefined;
  let stopped = false;
  void controller
    .checkForUpdate()
    .then((state) => {
      if (!stopped && state.updateAvailable) notify(state);
    })
    .catch(() => undefined);
  return () => {
    stopped = true;
  };
}
