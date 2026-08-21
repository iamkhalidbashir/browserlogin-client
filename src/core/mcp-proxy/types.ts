import { z } from "zod";

export const REMOTE_MCP_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;
export const REMOTE_MCP_BODY_CAP = 256 * 1024;
export const REMOTE_MCP_DISCOVERY_BUDGET_MS = 5_000;
export const REMOTE_MCP_RETRY_INTERVAL_MS = 60_000;

export type RemoteMcpProtocolVersion =
  (typeof REMOTE_MCP_PROTOCOL_VERSIONS)[number];
export type JsonRpcId = string | number | null;
export type JsonObject = Record<string, unknown>;

export type JsonRpcRequest<Params = unknown> = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Params;
};

export type JsonRpcSuccess<Result = unknown> = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: Result;
};

export type JsonRpcFailure = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
};

export type JsonRpcResponse<Result = unknown> =
  JsonRpcSuccess<Result> | JsonRpcFailure;

export type RemoteTool = {
  name: string;
  description?: string;
  inputSchema: JsonObject;
  [key: string]: unknown;
};

export type RemoteToolCallResult = JsonObject;
export type RemoteMcpStatus =
  "READY" | "REMOTE_UNAVAILABLE" | "REMOTE_AUTH_FAILED";

export const JsonRpcIdSchema = z.union([z.string(), z.number(), z.null()]);
export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcIdSchema.optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
});
const JsonRpcEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcIdSchema,
});

export const JsonRpcResponseSchema = z.union([
  JsonRpcEnvelopeSchema.extend({ result: z.unknown() }).strict(),
  JsonRpcEnvelopeSchema.extend({
    error: z.object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    }),
  }).strict(),
]);

export const InitializeResultSchema = z.object({
  protocolVersion: z.string(),
});

export const RemoteToolSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()),
  })
  .catchall(z.unknown());

export function isSupportedRemoteVersion(
  value: unknown,
): value is RemoteMcpProtocolVersion {
  return (
    typeof value === "string" &&
    (REMOTE_MCP_PROTOCOL_VERSIONS as readonly string[]).includes(value)
  );
}
