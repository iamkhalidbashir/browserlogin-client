/* global process */
import { appendFileSync } from "node:fs";

const capture = process.env.FAKE_VENDOR_CAPTURE;
process.stderr.write("Bearer test-secret token=private-value\n");
if (capture) {
  const safeEnv = [
    "PATH",
    "HOME",
    "USERPROFILE",
    "TMPDIR",
    "TMP",
    "TEMP",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "PATHEXT",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "LANGUAGE",
    "TZ",
    "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD",
  ];
  appendFileSync(
    capture,
    `${JSON.stringify({ argv: process.argv.slice(1), env: Object.fromEntries(safeEnv.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]]))) })}\n`,
  );
}

const tools = [
  "browser_resize",
  "browser_console_messages",
  "browser_handle_dialog",
  "browser_evaluate",
  "browser_file_upload",
  "browser_network_requests",
  "browser_snapshot",
  "browser_click",
  "browser_drag",
  "browser_hover",
  "browser_navigate",
  "browser_navigate_back",
  "browser_press_key",
  "browser_type",
  "browser_take_screenshot",
  "browser_wait_for",
  "browser_tab_list",
  "browser_tab_new",
  "browser_tab_close",
  "browser_tab_select",
];

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const request = JSON.parse(line);
    if (request.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-vendor", version: "1.0.0" },
        },
      });
    } else if (request.method === "notifications/initialized") {
      continue;
    } else if (request.method === "tools/list") {
      if (process.env.FAKE_VENDOR_MODE === "crash") process.exit(17);
      if (process.env.FAKE_VENDOR_MODE === "timeout") continue;
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          tools: tools.map((name) => ({
            name,
            description: name,
            inputSchema: { type: "object", properties: {} },
          })),
        },
      });
    } else if (request.method === "tools/call") {
      if (process.env.FAKE_VENDOR_MODE === "crash") process.exit(17);
      if (
        process.env.FAKE_VENDOR_MODE === "timeout" ||
        process.env.FAKE_VENDOR_MODE === "call-timeout"
      )
        continue;
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{ type: "text", text: request.params?.name ?? "unknown" }],
        },
      });
    }
  }
});
