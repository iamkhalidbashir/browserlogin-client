import { SOURCE_MANIFEST_TOOL_NAMES } from "./manifest";
import type { JsonObject, VendorCallResult } from "./types";

const CLOAK_DIALOG_CLOSED_ERROR =
  "### Error\nError: Protocol error (Page.handleJavaScriptDialog): No dialog is showing";
const DIALOG_HANDLED_RESULT = "### Result\nDialog handled.";

export const F2_VENDOR_TRANSLATIONS = {
  browser_run_code_unsafe: ["browser_evaluate"],
  browser_tabs: [
    "browser_tab_list",
    "browser_tab_new",
    "browser_tab_close",
    "browser_tab_select",
  ],
} as const;

export function translateToolCall(
  name: string,
  arguments_: JsonObject,
  toolNames: Set<string>,
): { name: string; arguments: JsonObject } {
  const action = arguments_.action;
  if (name === "browser_tabs" && !toolNames.has("browser_tabs")) {
    if (action === "new")
      return { name: "browser_tab_new", arguments: { url: arguments_.url } };
    if (action === "close" || action === "select")
      return {
        name: action === "close" ? "browser_tab_close" : "browser_tab_select",
        arguments: { index: arguments_.index },
      };
    return { name: "browser_tab_list", arguments: {} };
  }
  if (
    name === "browser_run_code_unsafe" &&
    !toolNames.has("browser_run_code_unsafe")
  )
    return {
      name: "browser_evaluate",
      arguments: { function: arguments_.code, filename: arguments_.filename },
    };
  return { name, arguments: arguments_ };
}

export function normalizeToolResult(
  name: string,
  result: VendorCallResult,
): VendorCallResult {
  if (
    name !== "browser_handle_dialog" ||
    result.isError !== true ||
    result.content.length !== 1 ||
    result.content[0]?.text !== CLOAK_DIALOG_CLOSED_ERROR
  )
    return result;
  return {
    ...result,
    content: [{ type: "text", text: DIALOG_HANDLED_RESULT }],
    isError: false,
  };
}

export function validateVendorTranslations(
  toolNames: Set<string>,
): Set<string> {
  const routerOwned = new Set([
    "browser_close",
    "browser_fill_form",
    "browser_select_option",
    "browser_tabs",
    "browser_run_code_unsafe",
  ]);
  const required = new Set<string>(
    SOURCE_MANIFEST_TOOL_NAMES.filter((name) => !routerOwned.has(name)),
  );
  for (const name of required) {
    if (toolNames.has(name)) continue;
    throw new Error("vendor capability mismatch");
  }
  const hasTabsTranslation = [
    "browser_tab_list",
    "browser_tab_new",
    "browser_tab_close",
    "browser_tab_select",
  ].every((translated) => toolNames.has(translated));
  if (!toolNames.has("browser_tabs") && !hasTabsTranslation)
    throw new Error("vendor capability mismatch");
  if (
    !toolNames.has("browser_run_code_unsafe") &&
    !toolNames.has("browser_evaluate")
  )
    throw new Error("vendor capability mismatch");
  return toolNames;
}
