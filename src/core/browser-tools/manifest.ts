import sourceManifest from "./playwright_manifest.json";
import type { JsonObject, VendorTool } from "./types";

export const SOURCE_MANIFEST_TOOL_COUNT = 24;
export const SOURCE_MANIFEST_TOOL_NAMES = [
  "browser_close",
  "browser_resize",
  "browser_console_messages",
  "browser_handle_dialog",
  "browser_evaluate",
  "browser_file_upload",
  "browser_drop",
  "browser_find",
  "browser_fill_form",
  "browser_press_key",
  "browser_type",
  "browser_navigate",
  "browser_navigate_back",
  "browser_network_requests",
  "browser_network_request",
  "browser_run_code_unsafe",
  "browser_take_screenshot",
  "browser_snapshot",
  "browser_click",
  "browser_drag",
  "browser_hover",
  "browser_select_option",
  "browser_tabs",
  "browser_wait_for",
] as const;

export const UNSAFE_TOOL_NAME = "browser_run_code_unsafe";
export const SAFE_TOOL_NAMES = SOURCE_MANIFEST_TOOL_NAMES.filter(
  (name) => name !== UNSAFE_TOOL_NAME,
);

const clone = <T>(value: T): T => structuredClone(value);

function withProfile(schema: JsonObject): JsonObject {
  const result = clone(schema);
  const properties =
    result.properties && typeof result.properties === "object"
      ? (result.properties as JsonObject)
      : {};
  result.properties = {
    ...properties,
    profile: {
      type: "string",
      minLength: 1,
      description: "Running BrowserLogin profile id",
    },
  };
  const required = Array.isArray(result.required) ? [...result.required] : [];
  if (!required.includes("profile")) required.push("profile");
  result.required = required;
  return result;
}

const sourceTools = sourceManifest as Array<{
  name: string;
  description?: string;
  inputSchema: JsonObject;
}>;

if (
  sourceTools.length !== SOURCE_MANIFEST_TOOL_COUNT ||
  sourceTools.map((tool) => tool.name).join("\n") !==
    SOURCE_MANIFEST_TOOL_NAMES.join("\n")
)
  throw new Error(
    "source Playwright manifest changed; update the checked-in snapshot",
  );

export const PRODUCT_TOOLS: readonly VendorTool[] = sourceTools.map((tool) => ({
  name: tool.name,
  ...(tool.description ? { description: tool.description } : {}),
  inputSchema: withProfile(tool.inputSchema),
}));

export function visibleTools(allowUnsafe: boolean): VendorTool[] {
  return PRODUCT_TOOLS.filter(
    (tool) => allowUnsafe || tool.name !== UNSAFE_TOOL_NAME,
  ).map((tool) => ({
    ...tool,
    inputSchema: clone(tool.inputSchema),
  }));
}

export function isManifestTool(name: string): boolean {
  return SOURCE_MANIFEST_TOOL_NAMES.includes(
    name as (typeof SOURCE_MANIFEST_TOOL_NAMES)[number],
  );
}
