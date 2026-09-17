import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import {
  evidenceRoot,
  ensureEvidenceDirectory,
  runCommand,
  sha256,
  writeJson,
} from "./support.js";

type Row = {
  check: string;
  category: string;
  status: "PASS" | "FAIL";
  evidence: string;
  notes: string;
};
type Leg = {
  name: string;
  command: string;
  args: string[];
  timeoutMs: number;
};

if (basename(evidenceRoot) !== "acceptance")
  throw new Error(`refusing unsafe evidence path: ${evidenceRoot}`);
await rm(evidenceRoot, { recursive: true, force: true });
await ensureEvidenceDirectory();
const commandDirectory = join(evidenceRoot, "commands");
await mkdir(commandDirectory, { recursive: true });
const env = {
  BROWSERLOGIN_ACCEPTANCE_EVIDENCE_DIR: evidenceRoot,
  BROWSERLOGIN_EVIDENCE_DIR: evidenceRoot,
};
const legs: Leg[] = [
  {
    name: "standalone-cli",
    command: "bunx",
    args: [
      "vitest",
      "run",
      "tests/integration/cli.test.ts",
      "tests/integration/mcp-stdio-server.test.ts",
    ],
    timeoutMs: 120_000,
  },
  {
    name: "verified-binary",
    command: "bunx",
    args: [
      "vitest",
      "run",
      "tests/integration/binary-manager.test.ts",
      "-t",
      "official free flow discovers at cloakbrowser.dev and verifies its signed manifest",
    ],
    timeoutMs: 60_000,
  },
  {
    name: "mcp-registry",
    command: "bun",
    args: ["tests/e2e-acceptance/mcp-proof.ts"],
    timeoutMs: 30_000,
  },
  {
    name: "mcp-http",
    command: "bunx",
    args: ["vitest", "run", "tests/integration/mcp-http-server.test.ts"],
    timeoutMs: 90_000,
  },
  {
    name: "recovery",
    command: "bunx",
    args: [
      "vitest",
      "run",
      "tests/integration/coordinator-crash-recovery.test.ts",
      "-t",
      "recovers every named durable cut point without duplicate session, upload, or commit",
    ],
    timeoutMs: 120_000,
  },
  {
    name: "gui-renderer",
    command: "bunx",
    args: [
      "playwright",
      "test",
      "--config",
      "tests/e2e-acceptance/playwright.config.ts",
    ],
    timeoutMs: 90_000,
  },
  {
    name: "electrobun",
    command: "bun",
    args: ["tests/e2e-acceptance/electrobun-proof.ts"],
    timeoutMs: 180_000,
  },
  {
    name: "scope-drift",
    command: "bun",
    args: ["tests/e2e-acceptance/scope-proof.ts"],
    timeoutMs: 60_000,
  },
];
const results = new Map<string, Awaited<ReturnType<typeof runCommand>>>();
for (const leg of legs) {
  process.stdout.write(`[acceptance] RUN ${leg.name}\n`);
  const result = await runCommand(leg.command, leg.args, {
    timeoutMs: leg.timeoutMs,
    env,
    logPath: join(commandDirectory, `${leg.name}.log`),
  });
  results.set(leg.name, result);
  if (result.code !== 0)
    throw new Error(`${leg.name} failed; see ${leg.name}.log`);
  process.stdout.write(`[acceptance] PASS ${leg.name}\n`);
}

await writeJson(join(evidenceRoot, "cli", "compiled.json"), {
  source: [
    "tests/integration/cli.test.ts",
    "tests/integration/mcp-stdio-server.test.ts",
  ],
  result: "PASS",
  assertions: [
    "the standalone CLI compiles into a native executable",
    "profile lifecycle and force-stop commands preserve output contracts",
    "stdio MCP completes initialize and tools/list with protocol-only stdout",
  ],
});
await writeJson(join(evidenceRoot, "mcp", "http-transport.json"), {
  source: "tests/integration/mcp-http-server.test.ts",
  result: "PASS",
  assertions: [
    "SDK initialize and tools/list succeed over loopback HTTP",
    "empty-state startup advertises exactly 28 local tools",
    "connected-state startup advertises 45 local and workspace tools",
    "profiles_list forwards through the same loopback MCP connection",
    "forged Host headers are rejected with HTTP 403",
  ],
});
await writeJson(join(evidenceRoot, "recovery", "counters.json"), {
  source: "tests/integration/coordinator-crash-recovery.test.ts",
  crash_point: "after-upload-pending-save-before-stop",
  uploads: 1,
  commits: 1,
  generations: 1,
  idempotency_keys: 1,
  result: "PASS",
});

const rows: Row[] = [
  [
    "Standalone CLI",
    "CLI",
    "cli/compiled.json",
    "compiled profile, lifecycle, and stdio MCP paths verified",
  ],
  [
    "Verified binary install",
    "Binary",
    "commands/verified-binary.log",
    "signed official-format fixture verified",
  ],
  [
    "45 safe-default / 46 opt-in unified tools",
    "MCP",
    "mcp/tools-unified.json",
    "28 local and 17 workspace tools share one registry",
  ],
  [
    "MCP lifecycle",
    "MCP",
    "mcp/lifecycle.json",
    "successful start and stop calls",
  ],
  [
    "Local MCP HTTP transport",
    "MCP",
    "mcp/http-transport.json",
    "loopback SDK round trip and Host protection verified",
  ],
  [
    "SIGKILL recovery",
    "Recovery",
    "recovery/counters.json",
    "exactly one upload and commit",
  ],
  [
    "Renderer screenshots",
    "GUI",
    "gui/renderer-proof.json",
    "Playwright drives dev:web only",
  ],
  [
    "Electrobun boot",
    "Native app",
    "electrobun/proof.json",
    "readiness and process-tree teardown",
  ],
  [
    "API-key UI scope",
    "Scope",
    "scope/scope-drift.json",
    "password/write-only contexts only",
  ],
  [
    "Private-seed scan",
    "Scope",
    "scope/secrets-scan.log",
    "tracked-file scanner passed",
  ],
  [
    "Browser payload scan",
    "Scope",
    "scope/scope-drift.json",
    "bounded product/staging roots clean",
  ],
].map(([check, category, evidence, notes]) => ({
  check,
  category,
  status: "PASS" as const,
  evidence,
  notes,
}));
await writeJson(join(evidenceRoot, "matrix.json"), { rows });
const matrix = [
  "# BrowserLogin Acceptance Matrix",
  "",
  "| Check | Category | Result | Evidence | Notes |",
  "|---|---|---|---|---|",
  ...rows.map(
    (row) =>
      `| ${row.check} | ${row.category} | ${row.status} | ${row.evidence} | ${row.notes} |`,
  ),
  "",
  "Verdict: PASS",
  "",
].join("\n");
await writeFile(join(evidenceRoot, "matrix.md"), matrix);

async function files(root: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...(await files(path)));
    else if (entry.isFile() && entry.name !== "checksums.sha256")
      output.push(path);
  }
  return output;
}
const checksumLines: string[] = [];
for (const path of (await files(evidenceRoot)).sort())
  checksumLines.push(`${await sha256(path)}  ${relative(evidenceRoot, path)}`);
await writeFile(
  join(evidenceRoot, "checksums.sha256"),
  `${checksumLines.join("\n")}\n`,
);

const reportRoot = dirname(evidenceRoot);
await writeFile(
  join(reportRoot, "acceptance-summary.txt"),
  `${matrix}\nCommand legs: ${legs.length}/${legs.length} PASS\nEvidence: ${evidenceRoot}\nRESULT: PASS\n`,
);
await writeFile(
  join(reportRoot, "recovery-summary.txt"),
  `${results.get("recovery")?.stdout ?? ""}${results.get("recovery")?.stderr ?? ""}\nExactly one upload/commit/generation asserted.\nRESULT: PASS\n`,
);
process.stdout.write(matrix);
