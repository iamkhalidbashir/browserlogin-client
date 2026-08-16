import { BrowserWindow, Updater } from "electrobun/main";

if (
  process.argv.includes("--browserlogin-smoke") ||
  process.env.BROWSERLOGIN_SPIKE_SMOKE === "1"
) {
  process.exit(0);
}

if (
  process.argv.includes("--browserlogin-updater-smoke") ||
  process.env.BROWSERLOGIN_SPIKE_UPDATER === "1"
) {
  const update = await Updater.checkForUpdate();
  if (update.error) {
    console.error(update.error);
    process.exit(1);
  }
  if (update.updateAvailable) {
    await Updater.downloadUpdate();
  }
  console.log(JSON.stringify({
    updateAvailable: update.updateAvailable,
    updateReady: Updater.updateInfo().updateReady,
  }));
  process.exit(0);
}

new BrowserWindow({
  title: "BrowserLogin",
  url: "views://mainview/index.html",
  frame: {
    width: 800,
    height: 600,
    x: 200,
    y: 200,
  },
});
