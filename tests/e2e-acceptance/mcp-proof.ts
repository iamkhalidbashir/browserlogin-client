import { join } from "node:path";
import {
  PRODUCT_TOOLS,
  visibleTools,
} from "../../src/core/browser-tools/manifest.js";
import type { RemoteTool } from "../../src/core/mcp-proxy/types.js";
import { createRegistry } from "../../src/mcp/registry.js";
import { REMOTE_TOOL_NAMES } from "../mocks/remote-mcp-server.js";
import { evidenceRoot, ensureEvidenceDirectory, writeJson } from "./support.js";

const mcpEvidence = join(evidenceRoot, "mcp");
await ensureEvidenceDirectory(mcpEvidence);
const lifecycleCalls: string[] = [];
const initializationCalls: string[] = [];
const remoteCalls: string[] = [];
const remoteTools: RemoteTool[] = REMOTE_TOOL_NAMES.map((name) => ({
  name,
  description: `Acceptance remote tool ${name}`,
  inputSchema: { type: "object", properties: {} },
}));
const browserRouter = {
  call: async (name: string) => ({ content: [{ type: "text", text: name }] }),
};
const connected = await createRegistry({
  lifecycle: {
    start: async (profileId) => lifecycleCalls.push(`start:${profileId}`),
    stop: async (profileId) => lifecycleCalls.push(`stop:${profileId}`),
    forceStop: async (profileId) => lifecycleCalls.push(`force:${profileId}`),
  },
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
  remoteTools,
  remoteForwarder: {
    call: async (name) => {
      remoteCalls.push(name);
      return {
        content: [{ type: "text", text: JSON.stringify({ profiles: [] }) }],
      };
    },
  },
});
const degraded = await createRegistry({
  lifecycle: {
    start: async () => undefined,
    stop: async () => undefined,
    forceStop: async () => undefined,
  },
  browserRouter,
  browserTools: visibleTools(false),
});
const connectedCatalog = await createRegistry({
  lifecycle: {
    start: async () => undefined,
    stop: async () => undefined,
    forceStop: async () => undefined,
  },
  browserRouter,
  browserTools: PRODUCT_TOOLS,
  remoteTools,
  remoteForwarder: { call: async () => ({ content: [] }) },
});
const degradedCatalog = await createRegistry({
  lifecycle: {
    start: async () => undefined,
    stop: async () => undefined,
    forceStop: async () => undefined,
  },
  browserRouter,
  browserTools: PRODUCT_TOOLS,
});
if (
  connected.tools.length !== 45 ||
  degraded.tools.length !== 28 ||
  connectedCatalog.tools.length !== 46 ||
  degradedCatalog.tools.length !== 29
)
  throw new Error("acceptance MCP safe/catalog tool counts are invalid");
const start = await connected.call("browser_session_start", {
  profile_id: "profile-1",
});
const stop = await connected.call("browser_session_stop", {
  profile_id: "profile-1",
});
const initialize = await connected.call("browser_init", { source: "free" });
const initializationStatus = await connected.call("browser_init_status", {});
const compatibilityStart = await connected.call("browserlogin_session_start", {
  profile_id: "compatibility-profile",
});
const compatibilityStop = await connected.call("browserlogin_session_stop", {
  profile_id: "compatibility-profile",
});
if (
  connected.tools.some((tool) =>
    ["browserlogin_session_start", "browserlogin_session_stop"].includes(
      tool.name,
    ),
  )
)
  throw new Error("local compatibility lifecycle names must not be advertised");
const profiles = await connected.call("profiles_list", {});
if (
  lifecycleCalls.join(",") !==
    "start:profile-1,stop:profile-1,start:compatibility-profile,stop:compatibility-profile" ||
  initializationCalls.join(",") !== "free" ||
  remoteCalls.join(",") !== "profiles_list"
)
  throw new Error("acceptance MCP lifecycle/remote calls did not complete");
await writeJson(join(mcpEvidence, "tools-connected.json"), {
  tools: connected.tools,
  count: connected.tools.length,
  catalogCount: connectedCatalog.tools.length,
});
await writeJson(join(mcpEvidence, "tools-degraded.json"), {
  tools: degraded.tools,
  count: degraded.tools.length,
  catalogCount: degradedCatalog.tools.length,
});
await writeJson(join(mcpEvidence, "lifecycle.json"), {
  calls: lifecycleCalls,
  start,
  stop,
  initialize,
  initializationStatus,
  compatibilityStart,
  compatibilityStop,
});
await writeJson(join(mcpEvidence, "profiles-list.json"), profiles);
await connected.shutdown();
await degraded.shutdown();
await connectedCatalog.shutdown();
await degradedCatalog.shutdown();
