import Electrobun, { Utils } from "electrobun/main";

type BeforeQuitEvent = { response?: { allow: boolean } };
type ApplicationEvents = {
  on(name: "before-quit", handler: (event: BeforeQuitEvent) => void): unknown;
};

export function installMainProcessShutdown(
  active: { stop(): Promise<void> },
  events: ApplicationEvents = Electrobun.events,
  quit: () => void = () => {
    Utils.quit();
  },
): void {
  let cleanupStarted = false;
  let cleanupFinished = false;
  events.on("before-quit", (event) => {
    if (cleanupFinished) return;
    event.response = { allow: false };
    if (cleanupStarted) return;
    cleanupStarted = true;
    void active
      .stop()
      .catch(() => {
        process.stderr.write("BrowserLogin shutdown cleanup failed\n");
      })
      .finally(() => {
        cleanupFinished = true;
        quit();
      });
  });
}
