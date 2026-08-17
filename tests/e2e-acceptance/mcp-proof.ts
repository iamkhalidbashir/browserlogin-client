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
  lifecycle: { start: async () => undefined, stop: async () => undefined },
  browserRouter,
  browserTools: visibleTools(false),
});
const connectedCatalog = await createRegistry({
  lifecycle: { start: async () => undefined, stop: async () => undefined },
  browserRouter,
  browserTools: PRODUCT_TOOLS,
  remoteTools,
  remoteForwarder: { call: async () => ({ content: [] }) },
});
const degradedCatalog = await createRegistry({
  lifecycle: { start: async () => undefined, stop: async () => undefined },
  browserRouter,
  browserTools: PRODUCT_TOOLS,
});
if (
  connected.tools.length !== 42 ||
  degraded.tools.length !== 25 ||
  connectedCatalog.tools.length !== 43 ||
  degradedCatalog.tools.length !== 26
)
  throw new Error("acceptance MCP safe/catalog tool counts are invalid");
const start = await connected.call("browserlogin_session_start", {
  profile_id: "profile-1",
});
const stop = await connected.call("browserlogin_session_stop", {
  profile_id: "profile-1",
});
const profiles = await connected.call("profiles_list", {});
if (
  lifecycleCalls.join(",") !== "start:profile-1,stop:profile-1" ||
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
});
await writeJson(join(mcpEvidence, "profiles-list.json"), profiles);
await connected.shutdown();
await degraded.shutdown();
await connectedCatalog.shutdown();
await degradedCatalog.shutdown();
