import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { PRODUCT_TOOLS } from "../core/browser-tools/manifest.js";
import type { VendorTool } from "../core/browser-tools/types.js";
import type { BrowserToolsRouter } from "../core/browser-tools/router.js";
import type { BrowserToolsLifecycle } from "../core/browser-tools/lifecycle.js";
import type {
  RemoteMcpDiscoveryCache,
  RemoteMcpForwarder,
} from "../core/mcp-proxy/index.js";
import type { JsonObject, RemoteTool } from "../core/mcp-proxy/types.js";
import { mergeRemoteTools } from "../core/mcp-proxy/forward.js";

export const START_TOOL: Tool = {
  name: "browserlogin_session_start",
  description: "Start the local BrowserLogin lifecycle for a profile.",
  inputSchema: {
    type: "object",
    properties: { profile_id: { type: "string" } },
    required: ["profile_id"],
    additionalProperties: false,
  },
};

export const STOP_TOOL: Tool = {
  name: "browserlogin_session_stop",
  description:
    "Stop the local BrowserLogin lifecycle for a profile and commit its encrypted archive.",
  inputSchema: {
    type: "object",
    properties: { profile_id: { type: "string" } },
    required: ["profile_id"],
    additionalProperties: false,
  },
};

export type LifecycleOperations = {
  start(profileId: string): Promise<unknown>;
  stop(profileId: string): Promise<unknown>;
};

export type RegistryDependencies = {
  lifecycle: LifecycleOperations;
  browserRouter: Pick<BrowserToolsRouter, "call">;
  browserLifecycle?: Pick<BrowserToolsLifecycle, "stop" | "shutdown">;
  remoteCache?: Pick<
    RemoteMcpDiscoveryCache,
    "discover" | "status" | "shutdown"
  >;
  remoteForwarder?: Pick<RemoteMcpForwarder, "call">;
  browserTools?: readonly VendorTool[];
  remoteTools?: readonly RemoteTool[];
};

export type UnifiedRegistry = {
  readonly tools: readonly Tool[];
  readonly degraded: boolean;
  call(
    name: string,
    arguments_: JsonObject,
    signal?: AbortSignal,
  ): Promise<CallToolResult>;
  shutdown(): Promise<void>;
};

const textResult = (text: string, isError = false): CallToolResult => ({
  content: [{ type: "text", text }],
  ...(isError ? { isError: true } : {}),
});

const objectArguments = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};

function asMcpTool(tool: VendorTool | RemoteTool): Tool {
  return {
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema as Tool["inputSchema"],
  };
}

export function localToolNames(
  browserTools: readonly VendorTool[] = PRODUCT_TOOLS,
): Set<string> {
  return new Set([
    START_TOOL.name,
    STOP_TOOL.name,
    ...browserTools.map((tool) => tool.name),
  ]);
}

export async function createRegistry(
  dependencies: RegistryDependencies,
): Promise<UnifiedRegistry> {
  const browserTools = dependencies.browserTools ?? PRODUCT_TOOLS;
  const localNames = localToolNames(browserTools);
  let remoteTools: readonly RemoteTool[] = dependencies.remoteTools ?? [];
  let degraded = true;
  if (dependencies.remoteCache && dependencies.remoteForwarder) {
    remoteTools = await dependencies.remoteCache.discover();
    degraded = dependencies.remoteCache.status !== "READY";
  }
  const mergedRemote = mergeRemoteTools(localNames, remoteTools);
  const tools = Object.freeze([
    START_TOOL,
    STOP_TOOL,
    ...browserTools.map(asMcpTool),
    ...mergedRemote.map(asMcpTool),
  ]);
  const names = new Set(tools.map((tool) => tool.name));

  return {
    tools,
    degraded,
    async call(name, arguments_, signal) {
      if (!names.has(name))
        return textResult("Tool request could not be completed.", true);
      try {
        if (name === START_TOOL.name) {
          const profileId = arguments_.profile_id;
          if (typeof profileId !== "string" || profileId.length === 0)
            return textResult(
              "Lifecycle request could not be completed.",
              true,
            );
          await Promise.resolve().then(() =>
            dependencies.lifecycle.start(profileId),
          );
          return textResult("BrowserLogin session started.");
        }
        if (name === STOP_TOOL.name) {
          const profileId = arguments_.profile_id;
          if (typeof profileId !== "string" || profileId.length === 0)
            return textResult(
              "Lifecycle request could not be completed.",
              true,
            );
          await Promise.resolve().then(
            () =>
              dependencies.browserLifecycle?.stop(profileId) ??
              dependencies.lifecycle.stop(profileId),
          );
          return textResult("BrowserLogin session stopped.");
        }
        if (localNames.has(name)) {
          return (await dependencies.browserRouter.call(
            name,
            arguments_,
          )) as unknown as CallToolResult;
        }
        if (!dependencies.remoteForwarder)
          return textResult("Remote MCP request could not be completed.", true);
        return (await dependencies.remoteForwarder.call(
          name,
          arguments_,
          signal,
        )) as unknown as CallToolResult;
      } catch {
        return textResult(
          name.startsWith("browserlogin_session")
            ? "Lifecycle request could not be completed."
            : name.startsWith("browser_")
              ? "Browser control request could not be completed."
              : "Remote MCP request could not be completed.",
          true,
        );
      }
    },
    async shutdown() {
      await dependencies.browserLifecycle?.shutdown();
      await Promise.resolve(dependencies.remoteCache?.shutdown());
    },
  };
}

export function argumentsForCall(value: unknown): JsonObject {
  return objectArguments(value);
}
