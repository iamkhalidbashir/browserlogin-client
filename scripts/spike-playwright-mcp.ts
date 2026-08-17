import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createConnection } from "@playwright/mcp";

type ManifestTool = { name: string };
type Decision = {
  decision: "in-process" | "f1-bundled" | "f2-vendor";
  playwrightMcpVersion: string;
  toolCount: number;
  manifestToolCount: number;
  missingTools: string[];
  extraTools: string[];
  evidence: {
    toolsList: "success" | "failure";
    browserNavigate: "success" | "timeout" | "failure";
    browserSnapshot: "success" | "timeout" | "failure";
    browserDownloadCacheBefore: string[];
    browserDownloadCacheAfter: string[];
  };
  browserDownloadSkipped: boolean;
  failures: string[];
};

const repoRoot = resolve(import.meta.dir, "..");
const manifestCandidates = [
  join(process.cwd(), "src/browserlogin_client/playwright_manifest.json"),
  join(process.cwd(), "../cloakbrowser-pro/browserlogin-client/src/browserlogin_client/playwright_manifest.json"),
  join(repoRoot, "src/browserlogin_client/playwright_manifest.json"),
  join(repoRoot, "../cloakbrowser-pro/browserlogin-client/src/browserlogin_client/playwright_manifest.json"),
];
const packageCandidates = [
  join(process.cwd(), "node_modules/@playwright/mcp/package.json"),
  join(repoRoot, "node_modules/@playwright/mcp/package.json"),
  join(repoRoot, "../cloakbrowser-pro/browserlogin-client/src/browserlogin_client/node/node_modules/@playwright/mcp/package.json"),
];

function browserPath(): string {
  const candidates = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter((value): value is string => Boolean(value));
  const path = candidates.find((candidate) => candidate.endsWith("Chrome") || candidate.endsWith("Chromium") || candidate.endsWith("google-chrome"));
  if (!path) throw new Error("No system Chromium-family browser found");
  return path;
}

async function firstExisting(paths: string[]): Promise<string> {
  for (const path of paths) {
    try {
      await readFile(path);
      return path;
    } catch (error) {
      void error;
    }
  }
  throw new Error(`None of these files exist: ${paths.join(", ")}`);
}

async function cacheEntries(): Promise<string[]> {
  const paths = process.env.PLAYWRIGHT_BROWSERS_PATH ? [process.env.PLAYWRIGHT_BROWSERS_PATH] : [];
  const entries: string[] = [];
  for (const path of paths) {
    try {
      const glob = new Bun.Glob("**/*");
      for await (const entry of glob.scan({ cwd: path, onlyFiles: true })) entries.push(join(path, entry));
    } catch (error) {
      void error;
    }
  }
  return entries.sort();
}

async function waitForCdp(endpoint: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) return;
    } catch (error) {
      void error;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for CDP at ${endpoint}`);
}

async function closeProcess(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolveExit) => process.once("exit", () => resolveExit())),
    sleep(2_000),
  ]);
  if (process.exitCode === null) process.kill("SIGKILL");
}

async function run(): Promise<Decision> {
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
  process.env.PLAYWRIGHT_BROWSERS_PATH = await mkdtemp(join(tmpdir(), "playwright-mcp-cache-"));
  const failures: string[] = [];
  const before = await cacheEntries();
  const profile = await mkdtemp(join(tmpdir(), "playwright-mcp-spike-"));
  const cdpPort = 39227;
  let chrome: ChildProcess | undefined;
  let client: Client | undefined;
  try {
    chrome = spawn(browserPath(), [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ], { stdio: "ignore" });
    const endpoint = `http://127.0.0.1:${cdpPort}`;
    await waitForCdp(endpoint);
    const server = await createConnection({
      browser: { cdpEndpoint: endpoint, isolated: false },
      capabilities: ["core", "core-tabs"],
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "playwright-mcp-spike", version: "0.1.0" }, { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    const manifestPath = await firstExisting(manifestCandidates);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ManifestTool[];
    const manifestNames = manifest.map((tool) => tool.name).sort();
    const navigated = await Promise.race([
      client.callTool({ name: "browser_navigate", arguments: { url: "about:blank" } }),
      sleep(5_000).then(() => ({ isError: true, content: [{ type: "text", text: "timeout" }] })),
    ]);
    const snapshot = await Promise.race([
      client.callTool({ name: "browser_snapshot", arguments: {} }),
      sleep(5_000).then(() => ({ isError: true, content: [{ type: "text", text: "timeout" }] })),
    ]);
    const navigateOk = !navigated.isError;
    const snapshotOk = !snapshot.isError && Array.isArray(snapshot.content) && snapshot.content.length > 0;
    const navigateEvidence = navigateOk ? "success" : JSON.stringify(navigated).includes("timeout") ? "timeout" : "failure";
    const snapshotEvidence = snapshotOk ? "success" : JSON.stringify(snapshot).includes("timeout") ? "timeout" : "failure";
    if (!navigateOk) failures.push(`in-process browser_navigate failed: ${JSON.stringify(navigated)}`);
    if (!snapshotOk) failures.push(`in-process browser_snapshot failed: ${JSON.stringify(snapshot)}`);
    const packagePath = await firstExisting(packageCandidates);
    const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as { version: string };
    return {
      decision: navigateOk && snapshotOk ? "in-process" : "f2-vendor",
      playwrightMcpVersion: packageJson.version,
      toolCount: names.length,
      manifestToolCount: manifestNames.length,
      missingTools: manifestNames.filter((name) => !names.includes(name)),
      extraTools: names.filter((name) => !manifestNames.includes(name)),
      evidence: {
        toolsList: "success",
        browserNavigate: navigateEvidence,
        browserSnapshot: snapshotEvidence,
        browserDownloadCacheBefore: before,
        browserDownloadCacheAfter: [],
      },
      browserDownloadSkipped: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1",
      failures,
    };
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    return {
      decision: "f2-vendor",
      playwrightMcpVersion: "unknown",
      toolCount: 0,
      manifestToolCount: 0,
      missingTools: [],
      extraTools: [],
      evidence: {
        toolsList: "failure",
        browserNavigate: "failure",
        browserSnapshot: "failure",
        browserDownloadCacheBefore: before,
        browserDownloadCacheAfter: [],
      },
      browserDownloadSkipped: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1",
      failures,
    };
  } finally {
    if (client) await client.close().catch(() => undefined);
    if (chrome) await closeProcess(chrome);
    await rm(profile, { recursive: true, force: true });
  }
}

const decision = await run();
decision.evidence.browserDownloadCacheAfter = await cacheEntries();
console.log(JSON.stringify(decision));
await rm(process.env.PLAYWRIGHT_BROWSERS_PATH ?? "", { recursive: true, force: true });
process.exitCode = 0;
