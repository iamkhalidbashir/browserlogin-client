import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

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
  testDir: ".",
  testMatch: "gui.spec.ts",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: join(process.cwd(), "test-results", "e2e-acceptance"),
  use: {
    baseURL: "http://127.0.0.1:4174",
    headless: true,
    launchOptions: executablePath ? { executablePath } : {},
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: "bun run dev:web -- --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174",
    timeout: 30_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
