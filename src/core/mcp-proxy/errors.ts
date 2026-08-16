import { BrowserLoginError } from "../../shared/errors";
import { safeErrorMessage } from "../../shared/redaction";

export type RemoteMcpErrorCode =
  | "REMOTE_AUTH_FAILED"
  | "REMOTE_BODY_TOO_LARGE"
  | "REMOTE_CANCELLED"
  | "REMOTE_INVALID_URL"
  | "REMOTE_PROTOCOL_ERROR"
  | "REMOTE_REDIRECT_REJECTED"
  | "REMOTE_TIMEOUT"
  | "REMOTE_UNAVAILABLE";

export class RemoteMcpError extends BrowserLoginError {
  readonly remoteCode: RemoteMcpErrorCode;
  readonly status?: number;

  constructor(
    code: RemoteMcpErrorCode,
    message = "Remote MCP request could not be completed.",
    status?: number,
  ) {
    super(safeErrorMessage(message), code);
    this.remoteCode = code;
    this.status = status;
  }
}
