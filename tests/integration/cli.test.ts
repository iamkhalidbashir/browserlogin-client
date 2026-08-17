import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const execute = promisify(execFile);
const BUN = process.env.BUN_BIN ?? "bun";
let root = "";
let binary = "";
let fixture = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "browserlogin-task24-"));
  binary = join(
    root,
    process.platform === "win32" ? "browserlogin.exe" : "browserlogin",
  );
  fixture = join(root, "cli-fixture.json");
  await writeFile(
    fixture,
    JSON.stringify({
      profilesList: [
        {
          id: "profile-1",
          name: "Research profile",
          platform: "macos",
          cloud: { archive_generation: 4, current_session_id: null },
        },
      ],
      sessionsStart: { status: "running" },
      sessionsStop: { status: "stopped" },
      sessionsForceStop: { status: "force-stopped" },
      connectionGet: {
        baseUrl: "https://example.test/api/v1",
        hasApiKey: true,
        hasLicense: false,
      },
      binaryDownload: {
        path: "/tmp/cloakbrowser",
        pro: false,
        source: "official",
        trust: "verified",
      },
    }),
    { mode: 0o600 },
  );
  await execute(
    BUN,
    ["build", "--compile", "src/cli/index.ts", "--outfile", binary],
    { cwd: process.cwd(), timeout: 90_000 },
  );
}, 100_000);

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function run(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  try {
    const result = await execute(binary, args, {
      cwd: process.cwd(),
      timeout: 15_000,
      env: {
        ...process.env,
        BROWSERLOGIN_TEST_MODE: "1",
        BROWSERLOGIN_CLI_FIXTURE: fixture,
        BROWSERLOGIN_STATE_DIR: root,
        ...extraEnv,
      },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as Error & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.code === "number" ? failure.code : -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message,
    };
  }
}

describe("Task 24 compiled browserlogin CLI", () => {
  test("matches profiles, lifecycle, force, and usage output contracts", async () => {
    await expect(run(["profiles"])).resolves.toEqual({
      code: 0,
      stdout:
        '[{"profile_id":"profile-1","name":"Research profile","platform":"macos","archive_generation":4,"cloud_session":false}]\n',
      stderr: "",
    });
    await expect(run(["start", "profile-1"])).resolves.toMatchObject({
      code: 0,
      stdout: "Profile started: profile-1\n",
    });
    await expect(run(["stop", "profile-1"])).resolves.toMatchObject({
      code: 0,
      stdout: "Profile stopped: profile-1\n",
    });
    await expect(
      run(["stop", "profile-1", "--force", "--yes"]),
    ).resolves.toMatchObject({
      code: 0,
      stdout: "Profile force closed: profile-1\n",
    });
    await expect(run(["stop", "profile-1", "--yes"])).resolves.toMatchObject({
      code: 2,
      stderr: "--yes is valid only with --force\n",
    });
  });

  test("supports JSON read commands, doctor, binary prefetch, and MCP setup exit", async () => {
    const profiles = await run(["profiles", "--json"]);
    expect(profiles.code).toBe(0);
    expect(() => JSON.parse(profiles.stdout)).not.toThrow();
    const doctor = await run(["doctor", "--json"]);
    expect(doctor.code).toBe(0);
    expect(JSON.parse(doctor.stdout)).toMatchObject({ connection: "ok" });
    const binaryResult = await run(["binary", "download"]);
    expect(binaryResult.code).toBe(0);
    expect(JSON.parse(binaryResult.stdout)).toMatchObject({
      source: "official",
      trust: "verified",
    });
    const mcp = await run(["mcp"], {
      BROWSERLOGIN_TEST_MODE: "0",
      BROWSERLOGIN_CLI_FIXTURE: "",
      BROWSERLOGIN_API_KEY: "",
    });
    expect(mcp.code).toBe(2);
    expect(mcp.stderr).toBe("BrowserLogin connection setup is required\n");
  });
});
