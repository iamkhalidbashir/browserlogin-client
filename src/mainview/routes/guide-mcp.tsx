import {
  MCP_CLIENT_CONFIGS,
  MCP_GUIDE_TOOL_GROUPS,
} from "../guides/catalog.js";
import {
  GuideDisclosure,
  GuidePage,
  GuideSection,
  GuideSnippet,
  GuideToolTable,
} from "../guides/guide-page.js";

const CONNECTION_CHECK = `browserlogin setup
browserlogin doctor --json`;

export default function McpGuide() {
  return (
    <GuidePage
      title="MCP guide"
      description="Connect AI clients to one local BrowserLogin server for profile lifecycle, browser automation, and remote workspace tools."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <article className="metric-card">
          <span>Local tools</span>
          <strong>28</strong>
        </article>
        <article className="metric-card">
          <span>With remote discovery</span>
          <strong>45</strong>
        </article>
        <article className="metric-card">
          <span>Transport</span>
          <strong className="text-xl">stdio</strong>
        </article>
      </div>

      <div className="panel">
        <h3 className="font-medium">Before connecting an AI client</h3>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          Install the compiled browserlogin CLI and its matching browser-tools
          helper, keep them together, and ensure browserlogin is on the AI
          client&apos;s inherited PATH. Run setup once so the API key remains in
          the operating-system keychain rather than a client configuration file.
        </p>
        <pre className="code-block mt-4">
          <code>{CONNECTION_CHECK}</code>
        </pre>
      </div>

      <GuideSection>
        <GuideDisclosure
          section={{
            name: "First AI workflow",
            description:
              "Start the browser runtime explicitly, operate a running profile, then stop it normally to preserve archive state.",
          }}
        >
          <ol className="grid list-decimal gap-3 pl-5 text-sm text-zinc-300">
            <li>
              Call <code>browser_init</code> with <code>source: "free"</code> if
              no verified CloakBrowser runtime exists. Use
              <code> browser_init_status</code> to inspect download progress.
            </li>
            <li>
              Call <code>browser_session_start</code> with the BrowserLogin
              <code> profile_id</code>.
            </li>
            <li>
              Use browser tools with the same <code>profile</code> identifier.
            </li>
            <li>
              Call <code>browser_session_stop</code> to preserve the profile
              archive. Use <code>force: true</code> only when discarding local
              changes is acceptable.
            </li>
          </ol>
        </GuideDisclosure>

        <GuideDisclosure
          section={{
            name: "AI client configurations",
            description:
              "Expand your client to copy its local stdio configuration. BrowserLogin must be on that client process PATH.",
          }}
        >
          <div className="grid gap-3">
            {MCP_CLIENT_CONFIGS.map((client) => (
              <GuideDisclosure key={client.name} section={client}>
                {client.snippets.length ? (
                  client.snippets.map((snippet) => (
                    <GuideSnippet key={snippet.label} snippet={snippet} />
                  ))
                ) : (
                  <p className="text-sm text-zinc-400">
                    Use the Standard stdio JSON configuration shown above.
                  </p>
                )}
              </GuideDisclosure>
            ))}
          </div>
        </GuideDisclosure>

        <GuideDisclosure
          section={{
            name: "Available AI tools",
            description:
              "All lifecycle, browser, unsafe opt-in, and remote workspace tools are grouped below. Expand a group to inspect exact arguments.",
          }}
        >
          <div className="grid gap-3">
            {MCP_GUIDE_TOOL_GROUPS.map((group) => (
              <GuideDisclosure key={group.name} section={group}>
                <GuideToolTable tools={group.tools} />
              </GuideDisclosure>
            ))}
          </div>
        </GuideDisclosure>
      </GuideSection>
    </GuidePage>
  );
}
