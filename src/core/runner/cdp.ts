import { constants } from "node:fs";
import { open } from "node:fs/promises";

export const readDevToolsPort = async (
  userDataDir: string,
): Promise<number | undefined> => {
  try {
    const fd = await open(
      `${userDataDir}/DevToolsActivePort`,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    let first: string | undefined;
    try {
      first = (await fd.readFile("utf8")).split(/\r?\n/, 1)[0]?.trim();
    } finally {
      await fd.close();
    }
    if (!first || !/^\d+$/.test(first)) return undefined;
    const port = Number(first);
    return port > 0 && port < 65536 ? port : undefined;
  } catch {
    return undefined;
  }
};

const fetchVersion = async (
  port: number,
  timeoutMs: number,
): Promise<string | undefined> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { webSocketDebuggerUrl?: unknown };
    if (typeof body.webSocketDebuggerUrl !== "string") return undefined;
    const endpoint = new URL(body.webSocketDebuggerUrl);
    if (
      endpoint.protocol !== "ws:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
    )
      return undefined;
    return endpoint.toString();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};

export async function resolveCdpEndpoint(
  userDataDir: string,
  timeoutMs = 20_000,
  pollMs = 250,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const port = await readDevToolsPort(userDataDir);
    if (port !== undefined) {
      const endpoint = await fetchVersion(
        port,
        Math.min(2_000, Math.max(1, deadline - Date.now())),
      );
      if (endpoint) return endpoint;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))),
    );
  }
  throw new Error("CDP endpoint did not become ready before timeout");
}
