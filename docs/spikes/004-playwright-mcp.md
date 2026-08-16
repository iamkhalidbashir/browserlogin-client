# Spike 004: `@playwright/mcp` programmatic API under Bun

## Decision

Task 4 uses the fallback ladder in this order:

1. **`in-process`:** create the Playwright MCP server with `createConnection`, connect it to an MCP SDK `InMemoryTransport` pair, and call tools directly.
2. **`f1-bundled`:** prove a real `bun build --compile` single-entry binary that embeds all required code and assets and runs without repository `node_modules` or system Node.
3. **`f2-vendor`:** if the first two paths fail, retain the Python manifest contract as a vendor adapter decision for Task 21.

The checked-in spike is the in-process evidence generator. It starts an installed system Chrome over CDP, never launches a Playwright-managed browser, and removes its temporary profile before exiting. The observed result selects **`f2-vendor`**: Bun 1.2.23 successfully performs `tools/list`, but both bounded browser calls time out. The real bundled compile attempt also fails on unresolved `chromium-bidi/...` and `electron` imports, so no bundled success is claimed.

## Observed API

The installed package is `@playwright/mcp` `0.0.34`. Its public export is `createConnection(config?, contextGetter?)`; the config shape accepts `browser.cdpEndpoint`, `browser.isolated`, and `capabilities`. The MCP server returned by `createConnection` exposes `connect(transport)`.

The MCP SDK provides `Client` and `InMemoryTransport.createLinkedPair()`. The spike connects the returned server and client through that linked pair, then exercises `tools/list`, `browser_navigate` with `about:blank`, and `browser_snapshot`. A tools-list-only result is not accepted as proof.

## Evidence

Run the source probe from the repository root with Bun 1.2.23:

```sh
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 ~/.bun/bin/bun run scripts/spike-playwright-mcp.ts
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 ~/.bun/bin/bun build scripts/spike-playwright-mcp.ts --compile --outfile /tmp/playwright-mcp-spike
```

The source JSON is recorded in `docs/evidence/task-4-source.log`. The unmodified compile failure is recorded in `docs/evidence/task-4-bundled-failure.log`, and the isolated no-download/cache proof is recorded in `docs/evidence/task-4-no-download.log`. The evidence records the observed-versus-manifest tool counts, missing/extra names, navigation and snapshot results, package version, browser-download cache state, and the selected fallback rung. No external Node process is part of the fallback proof.

## Task 21 integration contract

Task 21 must use **`f2-vendor`** on this Bun/macOS combination and treat the observed tool-name diff as version evidence rather than silently assuming parity. The vendor scope is the exact 24 Python manifest names, with a CDP session boundary that accepts an existing endpoint and owns browser context lifecycle outside the adapter. Estimate the adapter at roughly 1-2 engineer-days, excluding the final browser-tools router. It must set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` and use linked in-memory MCP transports where the vendor boundary exposes MCP. No package patching is justified because the real bundled build fails on unresolved optional imports and the plan explicitly accepts the vendor fallback.

## Verification limits

Context7 was requested for current official documentation but its service reported monthly quota exhaustion in this environment. The installed package exports, declarations, implementation, SDK declarations, and runtime behavior were inspected locally instead.
