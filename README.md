# browserlogin-client

BrowserLogin GUI and MCP lifecycle client for CloakBrowser sessions.

> **Status:** scaffold complete; implementation begins in subsequent tasks.

## Development

This project requires Bun 1.2.23. Install dependencies and run the checks:

```sh
bun install
bun run typecheck
bun run lint
bun run test
```

The project is an ESM package with strict TypeScript settings. The source layout
is organized for the upcoming core, CLI, MCP, Bun, and main-view modules.

## License

Licensed under the Business Source License 1.1. See [LICENSE](LICENSE).
