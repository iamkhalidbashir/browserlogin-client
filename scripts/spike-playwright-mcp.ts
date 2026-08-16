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
  decision: "F1_IN_PROCESS" | "F2_BUNDLED_SUBPROCESS" | "F3_MINIMAL_ADAPTER";
  scenario: "source" | "compiled";
  playwrightMcpVersion: string;
  observedToolCount: number;
  manifestToolCount: number;
  missingTools: string[];
  extraTools: string[];
  exercised: { navigate: boolean; snapshot: boolean };
  browserDownloadSkipped: boolean;
  probeCacheBefore: string[];
  probeCacheAfter: string[];
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
    } catch {}
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
    } catch {}
  }
  return entries.sort();
}

async function waitForCdp(endpoint: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) return;
    } catch {}
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

const nodeFallbackSource = `
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createConnection } from "@playwright/mcp";
const endpoint = process.argv[1];
const manifestPath = process.argv[2];
const server = await createConnection({ browser: { cdpEndpoint: endpoint, isolated: false }, capabilities: ["core", "core-tabs"] });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "playwright-mcp-spike-node-fallback", version: "0.1.0" }, { capabilities: {} });
await server.connect(serverTransport);
await client.connect(clientTransport);
const listed = await client.listTools();
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const navigated = await client.callTool({ name: "browser_navigate", arguments: { url: "about:blank" } });
const snapshot = await client.callTool({ name: "browser_snapshot", arguments: {} });
console.log(JSON.stringify({ names: listed.tools.map((tool) => tool.name).sort(), manifest: manifest.map((tool) => tool.name).sort(), navigated, snapshot }));
await client.close();
`;

async function runNodeFallback(endpoint: string, manifestPath: string): Promise<{
  names: string[];
  manifestNames: string[];
  navigateOk: boolean;
  snapshotOk: boolean;
  failure?: string;
}> {
  return await new Promise((resolveFallback) => {
    const child = spawn("node", ["--input-type=module", "-e", nodeFallbackSource, endpoint, manifestPath], { cwd: process.cwd() });
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("close", (code) => {
      if (code !== 0) {
        resolveFallback({ names: [], manifestNames: [], navigateOk: false, snapshotOk: false, failure: error.trim() || `node fallback exited ${code}` });
        return;
      }
      try {
        const result = JSON.parse(output);
        resolveFallback({
          names: result.names,
          manifestNames: result.manifest,
          navigateOk: !result.navigated.isError,
          snapshotOk: !result.snapshot.isError && Array.isArray(result.snapshot.content) && result.snapshot.content.length > 0,
        });
      } catch (parseError) {
        resolveFallback({ names: [], manifestNames: [], navigateOk: false, snapshotOk: false, failure: String(parseError) });
      }
    });
  });
}

async function run(): Promise<Decision> {
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
  process.env.PLAYWRIGHT_BROWSERS_PATH = await mkdtemp(join(tmpdir(), "playwright-mcp-cache-"));
  const scenario = process.argv.includes("--compiled") ? "compiled" : "source";
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
      sleep(5_000).then(() => ({ isError: true, content: [{ type: "text", text: "F1 CDP timeout under Bun" }] })),
    ]);
    const snapshot = navigated.isError ? { isError: true, content: [] } : await Promise.race([
      client.callTool({ name: "browser_snapshot", arguments: {} }),
      sleep(5_000).then(() => ({ isError: true, content: [{ type: "text", text: "F1 snapshot timeout under Bun" }] })),
    ]);
    const navigateOk = !navigated.isError;
    const snapshotOk = !snapshot.isError && Array.isArray(snapshot.content) && snapshot.content.length > 0;
    if (!navigateOk) failures.push(`F1 browser_navigate failed: ${JSON.stringify(navigated)}`);
    if (!snapshotOk) failures.push(`F1 browser_snapshot failed: ${JSON.stringify(snapshot)}`);
    const fallback = navigateOk && snapshotOk ? undefined : await runNodeFallback(endpoint, manifestPath);
    if (fallback && fallback.failure) failures.push(`F2 failed: ${fallback.failure}`);
    const finalNames = fallback?.names ?? names;
    const finalManifestNames = fallback?.manifestNames ?? manifestNames;
    const finalNavigateOk = fallback ? fallback.navigateOk : navigateOk;
    const finalSnapshotOk = fallback ? fallback.snapshotOk : snapshotOk;
    const packagePath = await firstExisting(packageCandidates);
    const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as { version: string };
    return {
      decision: finalNavigateOk && finalSnapshotOk ? (fallback ? "F2_BUNDLED_SUBPROCESS" : "F1_IN_PROCESS") : "F3_MINIMAL_ADAPTER",
      scenario,
      playwrightMcpVersion: packageJson.version,
      observedToolCount: finalNames.length,
      manifestToolCount: finalManifestNames.length,
      missingTools: finalManifestNames.filter((name) => !finalNames.includes(name)),
      extraTools: finalNames.filter((name) => !finalManifestNames.includes(name)),
      exercised: { navigate: finalNavigateOk, snapshot: finalSnapshotOk },
      browserDownloadSkipped: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1",
      probeCacheBefore: before,
      probeCacheAfter: [],
      failures,
    };
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    return {
      decision: "F2_BUNDLED_SUBPROCESS",
      scenario,
      playwrightMcpVersion: "unknown",
      observedToolCount: 0,
      manifestToolCount: 0,
      missingTools: [],
      extraTools: [],
      exercised: { navigate: false, snapshot: false },
      browserDownloadSkipped: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1",
      probeCacheBefore: before,
      probeCacheAfter: [],
      failures,
    };
  } finally {
    if (client) await client.close().catch(() => undefined);
    if (chrome) await closeProcess(chrome);
    await rm(profile, { recursive: true, force: true });
  }
}

const decision = await run();
decision.probeCacheAfter = await cacheEntries();
console.log(JSON.stringify(decision));
await rm(process.env.PLAYWRIGHT_BROWSERS_PATH ?? "", { recursive: true, force: true });
process.exitCode = decision.decision === "F3_MINIMAL_ADAPTER" ? 1 : 0;
