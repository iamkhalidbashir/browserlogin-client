import type { GuideTool } from "./types.js";

export const LIFECYCLE_TOOLS: readonly GuideTool[] = [
  {
    name: "browser_init",
    description: "Download, verify, and install CloakBrowser.",
    arguments: "Optional source: free or license.",
  },
  {
    name: "browser_init_status",
    description: "Report CloakBrowser download and install progress.",
    arguments: "None.",
  },
  {
    name: "browser_session_start",
    description: "Start the local lifecycle for a profile.",
    arguments: "profile_id",
  },
  {
    name: "browser_session_stop",
    description: "Stop normally or force-stop without committing an archive.",
    arguments: "profile_id; optional force",
  },
] as const;

export const BROWSER_TOOLS: readonly GuideTool[] = [
  {
    name: "browser_close",
    description: "Stop the BrowserLogin session and close its browser runtime.",
    arguments: "profile",
  },
  {
    name: "browser_resize",
    description: "Resize the browser window.",
    arguments: "profile, width, height",
  },
  {
    name: "browser_console_messages",
    description: "Read browser console messages at a chosen severity.",
    arguments: "profile, level",
  },
  {
    name: "browser_handle_dialog",
    description: "Accept or dismiss a JavaScript dialog.",
    arguments: "profile, accept",
  },
  {
    name: "browser_evaluate",
    description: "Evaluate a page or element JavaScript expression.",
    arguments: "profile, function",
  },
  {
    name: "browser_file_upload",
    description: "Upload files or cancel a file chooser.",
    arguments: "profile; optional paths",
  },
  {
    name: "browser_drop",
    description: "Drop files or MIME data onto an element.",
    arguments: "profile, target, paths or data",
  },
  {
    name: "browser_find",
    description:
      "Find text or a regular expression in the accessibility snapshot.",
    arguments: "profile, text or regex",
  },
  {
    name: "browser_fill_form",
    description: "Fill multiple fields through the humanized input path.",
    arguments: "profile, fields",
  },
  {
    name: "browser_press_key",
    description: "Press a key or generate a character.",
    arguments: "profile, key",
  },
  {
    name: "browser_type",
    description: "Type text into an editable element with humanized typing.",
    arguments: "profile, target, text",
  },
  {
    name: "browser_navigate",
    description: "Navigate the current tab to a URL.",
    arguments: "profile, url",
  },
  {
    name: "browser_navigate_back",
    description: "Return to the previous history entry.",
    arguments: "profile",
  },
  {
    name: "browser_network_requests",
    description: "List requests since the page loaded.",
    arguments: "profile, static",
  },
  {
    name: "browser_network_request",
    description:
      "Inspect a request or response from the numbered request list.",
    arguments: "profile, index",
  },
  {
    name: "browser_take_screenshot",
    description: "Save a screenshot of the current page or element.",
    arguments: "profile, scale",
  },
  {
    name: "browser_snapshot",
    description: "Capture an accessibility snapshot and element references.",
    arguments: "profile",
  },
  {
    name: "browser_click",
    description: "Click an element.",
    arguments: "profile, target",
  },
  {
    name: "browser_drag",
    description: "Drag between two elements.",
    arguments: "profile, startTarget, endTarget",
  },
  {
    name: "browser_hover",
    description: "Hover an element.",
    arguments: "profile, target",
  },
  {
    name: "browser_select_option",
    description: "Choose one dropdown option through the humanized input path.",
    arguments: "profile, target, values",
  },
  {
    name: "browser_tabs",
    description: "List, create, close, or select browser tabs.",
    arguments: "profile, action",
  },
  {
    name: "browser_wait_for",
    description: "Wait for text, disappearing text, or a duration.",
    arguments: "profile; time, text, or textGone as needed",
  },
  {
    name: "browser_modal_watch",
    description: "Handle the next file upload or JavaScript dialog.",
    arguments: "profile, kind",
  },
] as const;

export const UNSAFE_BROWSER_TOOLS: readonly GuideTool[] = [
  {
    name: "browser_run_code_unsafe",
    description:
      "Run arbitrary Playwright JavaScript in the browser-tools process. This is RCE-equivalent.",
    arguments: "profile; code or filename",
  },
] as const;
