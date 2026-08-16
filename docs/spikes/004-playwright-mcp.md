# Spike 004: `@playwright/mcp` programmatic API under Bun

## Decision

Task 4 uses the fallback ladder in this order:

1. **F1, in-process:** create the Playwright MCP server with `createConnection`, connect it to an MCP SDK `InMemoryTransport` pair, and call tools directly.
2. **F2, bundled single-entry subprocess:** if Bun compile cannot preserve F1, invoke a compiled single-entry MCP worker and bridge its stdio.
3. **F3, minimal 24-tool adapter:** only if F1 and F2 fail, retain the Python manifest contract and implement the smallest adapter around the exact 24 tools.

The checked-in spike is the evidence generator. It starts an installed system Chrome over CDP, never launches a Playwright-managed browser, and removes its temporary profile before exiting. The observed result selects **F2**: Bun 1.2.23 can list tools in-process, but its Playwright CDP websocket path times out; a single-entry Node subprocess preserves the MCP API and completes both browser calls.

## Observed API

The installed package is `@playwright/mcp` `0.0.34`. Its public export is `createConnection(config?, contextGetter?)`; the config shape accepts `browser.cdpEndpoint`, `browser.isolated`, and `capabilities`. The MCP server returned by `createConnection` exposes `connect(transport)`.

The MCP SDK provides `Client` and `InMemoryTransport.createLinkedPair()`. The spike connects the returned server and client through that linked pair, then exercises `tools/list`, `browser_navigate` with `about:blank`, and `browser_snapshot`. A tools-list-only result is not accepted as proof.

## Evidence

Run from the repository root with Bun 1.2.23:

```sh
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 ~/.bun/bin/bun run scripts/spike-playwright-mcp.ts
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 ~/.bun/bin/bun build scripts/spike-playwright-mcp.ts --compile --outfile /tmp/playwright-mcp-spike
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 /tmp/playwright-mcp-spike --compiled
```

The raw source and compiled JSON outputs are recorded in `docs/evidence/task-4-source.log` and `docs/evidence/task-4-compiled.log`. The logs record the observed-versus-manifest tool counts, missing/extra names, navigation and snapshot results, package version, browser-download cache state, and the selected fallback rung. Both runs must retain the two F1 timeout failures in the JSON decision object.

## Task 21 integration contract

Task 21 must use F2 on this Bun/macOS combination and treat the observed tool-name diff as version evidence rather than silently assuming parity. It must set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, supply an existing CDP endpoint, use linked in-memory MCP transports, and keep browser profile ownership outside `@playwright/mcp`. If a target platform cannot run the Node subprocess, estimate F3 as a minimal adapter for the Python manifest’s 24 names at roughly 1-2 engineer-days before implementation; no package patching is justified by this spike.

## Verification limits

Context7 was requested for current official documentation but its service reported monthly quota exhaustion in this environment. The installed package exports, declarations, implementation, SDK declarations, and runtime behavior were inspected locally instead.
