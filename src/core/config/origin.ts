export const DEFAULT_APP_ORIGIN =
  "https://example-1.app-csite-env.sapps.co";
export const REST_API_PATH = "/api/v1" as const;
export const REMOTE_MCP_PATH = "/mcp/browserSessionMCP" as const;

export function validateAppOrigin(value: string): string {
  if (
    value !== value.trim() ||
    !value.startsWith("https://") ||
    value.includes("\n") ||
    value.includes("\r")
  )
    throw new TypeError("application origin must use HTTPS");
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "" && parsed.pathname !== "/")
  )
    throw new TypeError("invalid application origin");
  return parsed.origin;
}

export function deriveRestBaseUrl(appOrigin: string): string {
  return `${validateAppOrigin(appOrigin)}${REST_API_PATH}`;
}

export function deriveRemoteMcpUrl(appOrigin: string): string {
  return `${validateAppOrigin(appOrigin)}${REMOTE_MCP_PATH}`;
}

export function legacyRestBaseUrlToOrigin(value: string): string {
  if (value !== value.trim())
    throw new TypeError("legacy REST base URL must be exact");
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== REST_API_PATH &&
      parsed.pathname !== `${REST_API_PATH}/`)
  )
    throw new TypeError("legacy REST base URL must end exactly with /api/v1");
  return parsed.origin;
}
