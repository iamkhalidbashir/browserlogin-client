import type { JsonObject } from "../core/mcp-proxy/types.js";

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function argumentsForCall(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}
