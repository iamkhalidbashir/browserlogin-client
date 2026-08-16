import { isIP } from "node:net";

const PROTOCOLS = new Set(["http", "https", "socks4", "socks5"]);

export type ProxyInput = {
  protocol: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
};

export type DirectProxy = string | {
  server: string;
  username?: string;
  password?: string;
};

export type ProxyRoute = {
  mode: "direct" | "relay";
  launchProxy: DirectProxy | null;
  upstream?: ProxyInput;
};

function formatHost(host: string): string {
  if (!host || ["/", "?", "#", "@", "[", "]"].some((character) => host.includes(character))) {
    throw new Error("proxy host is invalid");
  }
  const addressType = isIP(host);
  if (addressType === 6) {
    const parts = host.split("::");
    const left = parts[0] ? parts[0].split(":") : [];
    const right = parts[1] ? parts[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    const expanded = [...left, ...Array.from({ length: Math.max(0, missing) }, () => "0"), ...right]
      .map((part) => Number.parseInt(part || "0", 16).toString(16));
    let bestStart = -1;
    let bestLength = 0;
    for (let start = 0; start < expanded.length;) {
      if (expanded[start] !== "0") { start += 1; continue; }
      let end = start;
      while (end < expanded.length && expanded[end] === "0") end += 1;
      if (end - start > bestLength) { bestStart = start; bestLength = end - start; }
      start = end;
    }
    if (bestLength > 1) {
      const compressed = [...expanded.slice(0, bestStart), "", ...expanded.slice(bestStart + bestLength)];
      if (bestStart === 0) compressed.unshift("");
      if (bestStart + bestLength === expanded.length) compressed.push("");
      return `[${compressed.join(":")}]`;
    }
    return `[${expanded.join(":")}]`;
  }
  if (host.includes(":")) throw new Error("proxy host is invalid");
  return addressType === 4 ? host : host;
}

export function routeProxy(proxy: ProxyInput): ProxyRoute {
  const protocol = typeof proxy.protocol === "string" ? proxy.protocol.toLowerCase() : "";
  if (!PROTOCOLS.has(protocol)) throw new Error("proxy protocol is not supported");
  if (typeof proxy.host !== "string") throw new Error("proxy host is invalid");
  const host = formatHost(proxy.host);
  if (!Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535) {
    throw new Error("proxy port is invalid");
  }
  if (proxy.username !== undefined && typeof proxy.username !== "string") {
    throw new Error("proxy username is invalid");
  }
  if (proxy.password !== undefined && typeof proxy.password !== "string") {
    throw new Error("proxy password is invalid");
  }

  const server = `${protocol}://${host}:${proxy.port}`;
  const hasCredentials = proxy.username !== undefined || proxy.password !== undefined;
  if (protocol === "socks5" && hasCredentials) {
    return {
      mode: "relay",
      launchProxy: null,
      upstream: { protocol, host: proxy.host, port: proxy.port, username: proxy.username, password: proxy.password },
    };
  }
  if (protocol === "socks4" && hasCredentials) {
    throw new Error("SOCKS4 proxy credentials are not supported");
  }
  if (protocol === "https" && !hasCredentials) return { mode: "direct", launchProxy: server };
  if (protocol === "http" || protocol === "https") {
    const launchProxy: DirectProxy = { server };
    if (proxy.username !== undefined) launchProxy.username = proxy.username;
    if (proxy.password !== undefined) launchProxy.password = proxy.password;
    return { mode: "direct", launchProxy };
  }
  return { mode: "direct", launchProxy: server };
}
