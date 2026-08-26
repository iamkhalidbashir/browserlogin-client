import { CLI_GUIDE_COMMANDS } from "../guides/catalog.js";
import {
  GuideDisclosure,
  GuidePage,
  GuideSection,
} from "../guides/guide-page.js";

const QUICKSTART = `browserlogin setup
browserlogin binary download
browserlogin profiles --json
browserlogin start <PROFILE_ID>
browserlogin status --json
browserlogin stop <PROFILE_ID>`;

const ENVIRONMENT_SETUP = `export BROWSERLOGIN_API_KEY='bl_<KEY_ID>_<KEY_SECRET>'
export BROWSERLOGIN_BASE_URL='https://app.example.com'
export CLOAKBROWSER_LICENSE_KEY='<OPTIONAL_LICENSE_KEY>'
browserlogin doctor --json`;

export default function CliGuide() {
  return (
    <GuidePage
      title="CLI guide"
      description="Configure BrowserLogin, verify a browser runtime, manage profile lifecycles, and start the unified MCP server from the command line."
    >
      <div className="panel">
        <h3 className="font-medium">Quickstart</h3>
        <p className="mt-2 text-sm text-zinc-400">
          Run setup once, download a verified browser explicitly, then start and
          stop profiles through the same shared state used by the desktop app.
        </p>
        <pre className="code-block mt-4">
          <code>{QUICKSTART}</code>
        </pre>
      </div>

      <GuideSection>
        <GuideDisclosure
          section={{
            name: "Command reference",
            description:
              "Every supported command is listed here. Add --json for structured output where the command supports it.",
          }}
        >
          <div className="overflow-x-auto">
            <table className="data-table min-w-[40rem]">
              <thead>
                <tr>
                  <th scope="col">Command</th>
                  <th scope="col">Purpose</th>
                </tr>
              </thead>
              <tbody>
                {CLI_GUIDE_COMMANDS.map((command) => (
                  <tr key={command.command}>
                    <td>
                      <code>browserlogin {command.command}</code>
                    </td>
                    <td>{command.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GuideDisclosure>

        <GuideDisclosure
          section={{
            name: "Connection and environment",
            description:
              "Interactive setup keeps the API key in the OS keychain. Managed environments can provide process-level overrides instead.",
          }}
        >
          <p className="text-sm text-zinc-400">
            Enter the HTTPS BrowserLogin application origin, not an /api/v1 or
            /mcp URL. BrowserLogin derives the REST and remote MCP endpoints.
          </p>
          <pre className="code-block mt-4">
            <code>{ENVIRONMENT_SETUP}</code>
          </pre>
          <p className="mt-4 text-sm text-zinc-400">
            BROWSERLOGIN_API_KEY is required in environment mode.
            BROWSERLOGIN_BASE_URL and CLOAKBROWSER_LICENSE_KEY are optional. Do
            not put credentials in repository files or AI-client configs.
          </p>
        </GuideDisclosure>

        <GuideDisclosure
          section={{
            name: "Flags and exit codes",
            description: "Use only the flags that match the command being run.",
          }}
        >
          <ul className="grid gap-3 text-sm text-zinc-300">
            <li>
              <code>--state-dir &lt;absolute-path&gt;</code> overrides the
              shared state root for one invocation.
            </li>
            <li>
              <code>--force --yes</code> force-stops a profile without an
              archive and skips the exact confirmation prompt.
            </li>
            <li>
              <code>--pro</code> selects the licensed browser channel for
              <code> binary download</code>.
            </li>
            <li>
              Exit <code>0</code> means success, <code>2</code> means setup or
              usage is required, and <code>3</code> means an operational
              failure.
            </li>
          </ul>
        </GuideDisclosure>

        <GuideDisclosure
          section={{
            name: "MCP from the CLI",
            description:
              "The same executable starts the local stdio server used by AI clients.",
          }}
        >
          <pre className="code-block">
            <code>browserlogin mcp</code>
          </pre>
          <p className="mt-4 text-sm text-zinc-400">
            MCP reserves standard output for JSON-RPC. Configure an AI client to
            launch the command instead of typing into or redirecting its output.
          </p>
        </GuideDisclosure>
      </GuideSection>
    </GuidePage>
  );
}
