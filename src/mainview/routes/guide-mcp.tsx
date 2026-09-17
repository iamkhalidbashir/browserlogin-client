import {
  CHATGPT_DESKTOP_CONFIG,
  MCP_DEVELOPER_CONFIGS,
  MCP_GUIDE_TOOL_GROUPS,
  MCP_PLATFORM_SETUPS,
} from "../guides/catalog.js";
import { LOCAL_MCP_URL, PUBLIC_MCP_URL } from "../../shared/mcp-endpoints.js";
import {
  GuideDisclosure,
  GuideCopyField,
  GuidePage,
  GuideSection,
  GuideSnippet,
  GuideSteps,
  GuideToolTable,
} from "../guides/guide-page.js";

export default function McpGuide() {
  return (
    <GuidePage
      title="MCP guide"
      description="Connect an AI client to one BrowserLogin endpoint for local browser control and hosted workspace tools. Start with the desktop setup below."
    >
      <section
        aria-labelledby="local-mcp-title"
        className="panel"
        data-guide-section="local-endpoint"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Local and workspace tools</p>
            <h3 id="local-mcp-title" className="text-xl font-semibold">
              Connect one endpoint on this computer
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="status-pill">
              46 safe-default tools after setup
            </span>
            <span className="status-pill">Streamable HTTP</span>
          </div>
        </div>
        <p className="guide-muted mt-2 max-w-3xl text-sm">
          BrowserLogin starts this endpoint automatically with 29 local
          lifecycle, attention, and browser tools before Connection setup. After
          setup, the same endpoint exposes 46 safe-default tools: 29 local tools
          plus 17 hosted workspace tools.
        </p>
        <div className="mt-5">
          <GuideCopyField
            label="local MCP endpoint"
            prominent
            value={LOCAL_MCP_URL}
          />
        </div>
        <p className="guide-muted mt-4 max-w-3xl text-sm">
          BrowserLogin manages hosted credentials, so clients need no second MCP
          connection or authorization header. Command-launching clients can use{" "}
          <code>browserlogin mcp</code>; stdio exposes the same merged registry.
        </p>
        <ol className="mt-5 grid gap-3 text-sm md:grid-cols-3">
          <li>
            <strong className="guide-step-label block">1. Install</strong>
            <span className="guide-muted mt-1 block">
              Get BrowserLogin for your operating system.
            </span>
          </li>
          <li>
            <strong className="guide-step-label block">2. Connect</strong>
            <span className="guide-muted mt-1 block">
              Open the app and complete Connection setup.
            </span>
          </li>
          <li>
            <strong className="guide-step-label block">3. Keep it open</strong>
            <span className="guide-muted mt-1 block">
              The local MCP server stops when BrowserLogin closes.
            </span>
          </li>
        </ol>
        <div className="guide-divider mt-6 border-t pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="font-medium">Install BrowserLogin</h4>
            <a
              className="table-action"
              href="https://github.com/iamkhalidbashir/browserlogin-client/releases"
              rel="noreferrer"
              target="_blank"
            >
              Open GitHub Releases
            </a>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {MCP_PLATFORM_SETUPS.map((setup) => (
              <div data-platform-id={setup.id} key={setup.id}>
                <GuideDisclosure section={setup}>
                  <GuideSteps steps={setup.steps} />
                  {setup.snippet ? (
                    <GuideSnippet snippet={setup.snippet} />
                  ) : null}
                </GuideDisclosure>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        aria-labelledby="chatgpt-setup-title"
        className="panel"
        data-client-id={CHATGPT_DESKTOP_CONFIG.id}
        data-guide-section="client-setup"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Recommended setup</p>
            <h3 id="chatgpt-setup-title" className="text-xl font-semibold">
              {CHATGPT_DESKTOP_CONFIG.name}
            </h3>
          </div>
          <span className="status-pill">macOS · Windows · Linux</span>
        </div>
        <p className="guide-muted mt-2 max-w-3xl text-sm">
          {CHATGPT_DESKTOP_CONFIG.description}
        </p>
        <div className="mt-4">
          <GuideSteps steps={CHATGPT_DESKTOP_CONFIG.steps} />
        </div>
        <p className="guide-muted mt-4 border-l-2 border-zinc-500 pl-3 text-sm">
          <strong className="guide-body">Using ChatGPT in a browser?</strong>{" "}
          ChatGPT web cannot reach localhost. Use the desktop app for local
          browser control.
        </p>
      </section>

      <section
        aria-labelledby="developer-clients-title"
        data-guide-section="developer-clients"
      >
        <GuideDisclosure
          section={{
            name: "Editor and terminal clients",
            description:
              "Cursor, VS Code, Claude Code, Codex CLI, and OpenCode use the same local URL.",
          }}
        >
          <h3 id="developer-clients-title" className="sr-only">
            Editor and terminal clients
          </h3>
          <div className="grid gap-3 xl:grid-cols-2">
            {MCP_DEVELOPER_CONFIGS.map((client) => (
              <div data-client-id={client.id} key={client.id}>
                <GuideDisclosure section={client}>
                  <GuideSteps steps={client.steps} />
                  {client.snippets.map((snippet) => (
                    <GuideSnippet key={snippet.label} snippet={snippet} />
                  ))}
                </GuideDisclosure>
              </div>
            ))}
          </div>
        </GuideDisclosure>
      </section>

      <GuideSection>
        <section
          data-guide-section="first-workflow"
          aria-label="First AI workflow"
        >
          <GuideDisclosure
            section={{
              name: "First AI workflow",
              description:
                "Install the browser runtime if needed, start a profile, then stop it normally to preserve its archive.",
            }}
          >
            <ol className="guide-body grid list-decimal gap-3 pl-5 text-sm">
              <li>
                Call <code>browser_init</code> if no verified CloakBrowser
                runtime exists. Check progress with{" "}
                <code>browser_init_status</code>.
              </li>
              <li>
                Call <code>browser_session_start</code>, then use its profile ID
                with browser tools.
              </li>
              <li>
                Call <code>browser_session_stop</code> normally to preserve the
                profile archive.
              </li>
            </ol>
          </GuideDisclosure>
        </section>

        <section
          data-guide-section="tool-catalog"
          aria-label="Available AI tools"
        >
          <GuideDisclosure
            section={{
              name: "Available AI tools",
              description:
                "Browse local browser tools and hosted workspace tools by capability.",
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
        </section>
      </GuideSection>

      <section
        aria-labelledby="public-mcp-title"
        className="panel"
        data-guide-section="public-endpoint"
      >
        <p className="eyebrow">Optional hosted-only fallback</p>
        <h3 id="public-mcp-title" className="text-xl font-semibold">
          Public MCP endpoint
        </h3>
        <p className="guide-muted mt-2 max-w-3xl text-sm">
          This optional hosted-only fallback provides 17 workspace tools when
          your client cannot reach localhost. It is not a required second
          connection and cannot control local browsers.
        </p>
        <div className="mt-4">
          <GuideCopyField
            label="public MCP endpoint"
            value={PUBLIC_MCP_URL}
            wrap
          />
        </div>
        <p className="guide-muted mt-4 text-sm">
          Send <code>Authorization: Bearer &lt;BROWSERLOGIN_API_KEY&gt;</code>{" "}
          with every request. Store the key as a client secret, never in source
          control.
        </p>
      </section>
    </GuidePage>
  );
}
