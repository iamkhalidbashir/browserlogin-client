const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { program, z } = require("playwright-core/lib/utilsBundle");
const { tools, libCli } = require("playwright-core/lib/coreBundle");
const { source: userModalInitPage } = require("./user-modal-init-page.cjs");

const modalControllers = new WeakMap();
globalThis.__browserloginModalControllers = modalControllers;
tools.browserTools.push({
  capability: "core",
  schema: {
    name: "browser_modal_watch",
    title: "Watch browser modal",
    description:
      "Temporarily let the agent handle the next file upload or JavaScript dialog.",
    inputSchema: z.object({
      kind: z.enum(["file_upload", "dialog"]),
      timeout_ms: z.number().int().min(1).max(300_000).default(30_000),
    }),
    type: "action",
  },
  handle: async (context, params, response) => {
    const tab = await context.ensureTab();
    const controller = modalControllers.get(tab.page);
    if (!controller) {
      response.addError("Error: Browser modal watching is not ready.");
      return;
    }
    const event = params.kind === "file_upload" ? "filechooser" : "dialog";
    controller.watch(event, params.timeout_ms);
    response.addTextResult(`Agent is handling the next ${params.kind} modal.`);
  },
});

const directory = mkdtempSync(join(tmpdir(), "browserlogin-mcp-"));
const initPage = join(directory, "user-modal-init-page.cjs");
writeFileSync(initPage, userModalInitPage, { mode: 0o600 });
process.once("exit", () => rmSync(directory, { recursive: true, force: true }));

const argv = [...process.argv, "--init-page", initPage];
if (argv.includes("install-browser")) {
  libCli.decorateProgram(program);
  void program.parseAsync(
    argv.map((argument) =>
      argument === "install-browser" ? "install" : argument,
    ),
  );
} else {
  tools.decorateMCPCommand(program);
  void program.parseAsync(argv);
}
