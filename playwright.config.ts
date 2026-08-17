import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const candidateExecutable =
  process.env.BROWSERLOGIN_CHROMIUM_PATH ??
  (process.platform === "darwin"
    ? "/Applications/Chromium.app/Contents/MacOS/Chromium"
    : process.platform === "win32"
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : "/usr/bin/chromium");
const executablePath = existsSync(candidateExecutable)
  ? candidateExecutable
  : undefined;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  outputDir: "test-results/playwright",
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    launchOptions: executablePath ? { executablePath } : {},
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
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
