import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type {
  AttentionResult,
  AttentionResultCode,
  AttentionService,
} from "../core/attention/index.js";

export const ATTENTION_TOOL: Tool = {
  name: "browserlogin_request_attention",
  description:
    "Request a local BrowserLogin notification, sound, or both when user attention is needed.",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        minLength: 1,
        maxLength: 80,
        default: "BrowserLogin",
      },
      message: { type: "string", minLength: 1, maxLength: 500 },
    },
    required: ["message"],
    additionalProperties: false,
  },
};

const ATTENTION_RESULT_TEXT = {
  ATTENTION_SUBMITTED: "Attention request submitted.",
  ATTENTION_PARTIAL: "Attention request partially submitted.",
  ATTENTION_DISABLED: "Attention requests are disabled.",
  ATTENTION_RATE_LIMITED: "Attention request rate limit exceeded.",
  ATTENTION_UNAVAILABLE: "Attention request is unavailable.",
  ATTENTION_FAILED: "Attention request could not be completed.",
  ATTENTION_INVALID_INPUT: "Attention request input is invalid.",
  ATTENTION_CANCELLED: "Attention request was cancelled.",
} as const satisfies Record<AttentionResultCode, string>;

export function attentionResult(result: AttentionResult): CallToolResult {
  return {
    content: [{ type: "text", text: ATTENTION_RESULT_TEXT[result.code] }],
    structuredContent: { ...result },
    isError:
      result.code !== "ATTENTION_SUBMITTED" &&
      result.code !== "ATTENTION_PARTIAL",
  };
}

export function callAttention(
  service: Pick<AttentionService, "request"> | undefined,
  input: unknown,
  signal?: AbortSignal,
): Promise<CallToolResult> {
  if (!service)
    return Promise.resolve(
      attentionResult({
        code: "ATTENTION_UNAVAILABLE",
        audio: "skipped",
        notification: "skipped",
      }),
    );
  return service.request(input, signal).then(attentionResult, () =>
    attentionResult({
      code: "ATTENTION_FAILED",
      audio: "skipped",
      notification: "skipped",
    }),
  );
}
