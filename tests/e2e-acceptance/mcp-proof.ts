import { join } from "node:path";
import {
  PRODUCT_TOOLS,
  visibleTools,
} from "../../src/core/browser-tools/manifest.js";
import type {
  RemoteTool,
  RemoteToolCallResult,
} from "../../src/core/mcp-proxy/types.js";
import { createRegistry } from "../../src/mcp/registry.js";
import { REMOTE_TOOL_NAMES } from "../mocks/remote-mcp-server.js";
import { evidenceRoot, ensureEvidenceDirectory, writeJson } from "./support.js";

const mcpEvidence = join(evidenceRoot, "mcp");
await ensureEvidenceDirectory(mcpEvidence);
const lifecycleCalls: string[] = [];
const initializationCalls: string[] = [];
const remoteCalls: string[] = [];
const browserRouter = {
  call: async (name: string) => ({ content: [{ type: "text", text: name }] }),
};
const lifecycle = {
  start: async (profileId: string) => lifecycleCalls.push(`start:${profileId}`),
  stop: async (profileId: string) => lifecycleCalls.push(`stop:${profileId}`),
  forceStop: async (profileId: string) =>
    lifecycleCalls.push(`force:${profileId}`),
};
const remoteTools = REMOTE_TOOL_NAMES.map((name): RemoteTool => ({
  name,
  description: `BrowserLogin ${name}`,
  inputSchema: { type: "object" },
}));
const remote = {
  remoteCache: {
    status: "READY" as const,
    discover: async () => remoteTools,
    shutdown: () => undefined,
  },
  remoteForwarder: {
    call: async (name: string): Promise<RemoteToolCallResult> => {
      remoteCalls.push(name);
      return {
        content: [{ type: "text", text: name }],
        isError: false,
      };
    },
  },
};
const localOnly = await createRegistry({
  lifecycle,
  browserRouter,
  browserTools: visibleTools(false),
});
const unified = await createRegistry({
  lifecycle,
  binaryInitialization: {
    initialize: async (source) => {
      initializationCalls.push(source);
      return {
        state: "ready",
        downloaded: 10,
        total: 10,
        binary: {
          path: "/tmp/cloakbrowser",
          version: "1.0.0",
          platform: "darwin-arm64",
          pro: source === "license",
          sha256: undefined,
          binarySha256: undefined,
          source: "official",
          trust: "verified",
        },
      };
    },
    status: async () => ({
      state: "not-installed",
      downloaded: 0,
      total: null,
      binary: null,
    }),
  },
  browserRouter,
  browserTools: visibleTools(false),
  ...remote,
});
const unifiedCatalog = await createRegistry({
  lifecycle,
  browserRouter,
  browserTools: PRODUCT_TOOLS,
  ...remote,
});
if (
  localOnly.tools.length !== 28 ||
  unified.tools.length !== 45 ||
  unifiedCatalog.tools.length !== 46
)
  throw new Error("acceptance unified MCP tool counts are invalid");
if (
  !REMOTE_TOOL_NAMES.every((remoteName) =>
    unified.tools.some((tool) => tool.name === remoteName),
  )
)
  throw new Error("workspace tools must appear in the unified MCP registry");
const start = await unified.call("browser_session_start", {
  profile_id: "profile-1",
});
const stop = await unified.call("browser_session_stop", {
  profile_id: "profile-1",
});
const initialize = await unified.call("browser_init", { source: "free" });
const initializationStatus = await unified.call("browser_init_status", {});
const compatibilityStart = await unified.call("browserlogin_session_start", {
  profile_id: "compatibility-profile",
});
const compatibilityStop = await unified.call("browserlogin_session_stop", {
  profile_id: "compatibility-profile",
});
const workspace = await unified.call("profiles_list", {});
if (
  unified.tools.some((tool) =>
    ["browserlogin_session_start", "browserlogin_session_stop"].includes(
      tool.name,
    ),
  )
)
  throw new Error("local compatibility lifecycle names must not be advertised");
if (
  lifecycleCalls.join(",") !==
    "start:profile-1,stop:profile-1,start:compatibility-profile,stop:compatibility-profile" ||
  initializationCalls.join(",") !== "free" ||
  remoteCalls.join(",") !== "profiles_list" ||
  workspace.isError === true
)
  throw new Error("acceptance unified MCP dispatch did not complete");
await writeJson(join(mcpEvidence, "tools-unified.json"), {
  tools: unified.tools,
  localOnlyCount: localOnly.tools.length,
  count: unified.tools.length,
  catalogCount: unifiedCatalog.tools.length,
});
await writeJson(join(mcpEvidence, "lifecycle.json"), {
  calls: lifecycleCalls,
  remoteCalls,
  start,
  stop,
  initialize,
  initializationStatus,
  compatibilityStart,
  compatibilityStop,
  workspace,
});
await localOnly.shutdown();
await unified.shutdown();
await unifiedCatalog.shutdown();
