import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const START_TOOL: Tool = {
  name: "browser_session_start",
  description: "Start the local BrowserLogin lifecycle for a profile.",
  inputSchema: {
    type: "object",
    properties: { profile_id: { type: "string" } },
    required: ["profile_id"],
    additionalProperties: false,
  },
};

export const STOP_TOOL: Tool = {
  name: "browser_session_stop",
  description:
    "Stop the local BrowserLogin lifecycle for a profile. Set force to true to stop without committing an archive.",
  inputSchema: {
    type: "object",
    properties: {
      profile_id: { type: "string" },
      force: { type: "boolean" },
    },
    required: ["profile_id"],
    additionalProperties: false,
  },
};

export const LOCAL_COMPAT_START_TOOL_NAME = "browserlogin_session_start";
export const LOCAL_COMPAT_STOP_TOOL_NAME = "browserlogin_session_stop";

export const START_TOOL_NAMES: ReadonlySet<string> = new Set([
  START_TOOL.name,
  LOCAL_COMPAT_START_TOOL_NAME,
]);

export const STOP_TOOL_NAMES: ReadonlySet<string> = new Set([
  STOP_TOOL.name,
  LOCAL_COMPAT_STOP_TOOL_NAME,
]);

export type LifecycleOperations = {
  start(profileId: string): Promise<unknown>;
  stop(profileId: string): Promise<unknown>;
  forceStop(profileId: string): Promise<unknown>;
};
