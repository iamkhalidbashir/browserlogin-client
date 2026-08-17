import { defineConfig } from "@playwright/test";

const executablePath =
  process.env.BROWSERLOGIN_CHROMIUM_PATH ??
  (process.platform === "darwin"
    ? "/Applications/Chromium.app/Contents/MacOS/Chromium"
    : process.platform === "win32"
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : "/usr/bin/chromium");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    launchOptions: { executablePath },
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: "bun run dev:web -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    timeout: 30_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
