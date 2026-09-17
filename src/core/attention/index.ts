export { createLinuxAttentionAdapter } from "./linux.js";
export { createMacOSAttentionAdapter } from "./macos.js";
export { createWindowsAttentionAdapter } from "./windows.js";
export {
  ATTENTION_COOLDOWN_MS,
  ATTENTION_RESULT_CODES,
  AttentionRequestSchema,
  createAttentionService,
  createPlatformAttentionAdapter,
} from "./service.js";
export type {
  AttentionChannelStatus,
  AttentionRequest,
  AttentionResult,
  AttentionResultCode,
  AttentionService,
  AttentionServiceOptions,
  AttentionSettings,
} from "./service.js";
export { ATTENTION_SOUNDS } from "./types.js";
export type {
  AttentionAdapter,
  AttentionNotification,
  AttentionOutcome,
  AttentionSound,
} from "./types.js";
