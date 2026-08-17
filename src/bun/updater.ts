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
    const result = await this.check();
    return {
      channel: UPDATE_CHANNEL,
      updateAvailable: Boolean(result.updateAvailable),
      updateReady: Boolean(result.updateReady),
      version: result.version || undefined,
      error: result.error ? "Update check failed" : undefined,
      fallbackUrl: result.updateAvailable ? RELEASE_PAGE : undefined,
    };
  }

  async downloadUpdate(): Promise<UpdateState> {
    const checked = await this.checkForUpdate();
    if (!checked.updateAvailable) return checked;
    await this.download();
    const info = await this.info();
    return { ...checked, updateReady: Boolean(info?.updateReady) };
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
      return {
        channel: UPDATE_CHANNEL,
        updateAvailable: true,
        updateReady: false,
      };
    } catch {
      this.openExternal(RELEASE_PAGE);
      return {
        channel: UPDATE_CHANNEL,
        updateAvailable: true,
        updateReady: true,
        error: "Update could not be applied automatically.",
        fallbackUrl: RELEASE_PAGE,
      };
    }
  }
}

export function installLaunchUpdateCheck(
  notify: (state: UpdateState) => void,
  controller = new UpdateController(),
): () => void {
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
