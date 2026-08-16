export type KeychainErrorCode =
  "NOT_FOUND" | "BACKEND_UNAVAILABLE" | "LOCKED" | "DENIED" | "TIMEOUT";

export class BrowserLoginError extends Error {
  code: string;

  constructor(
    message: string,
    code = "BROWSERLOGIN_ERROR",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ApiError extends BrowserLoginError {
  readonly status: number;

  constructor(
    status: number,
    message = `BrowserLogin request failed with HTTP ${status}`,
    options?: ErrorOptions,
  ) {
    super(message, "API_ERROR", options);
    this.status = status;
  }
}

export class ConflictError extends ApiError {
  constructor(
    message = "BrowserLogin request conflicted",
    options?: ErrorOptions,
  ) {
    super(409, message, options);
    this.code = "CONFLICT";
  }
}

export class PreconditionError extends ApiError {
  constructor(
    message = "BrowserLogin request precondition failed",
    options?: ErrorOptions,
  ) {
    super(412, message, options);
    this.code = "PRECONDITION_FAILED";
  }
}

export class ArchiveError extends BrowserLoginError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "ARCHIVE_ERROR", options);
  }
}

export class ProcessIdentityError extends BrowserLoginError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "PROCESS_IDENTITY_ERROR", options);
  }
}

export class StateError extends BrowserLoginError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "STATE_ERROR", options);
  }
}

export class KeychainError extends BrowserLoginError {
  readonly category = "KEYCHAIN_ERROR" as const;
  readonly keychain_code: KeychainErrorCode;

  constructor(
    code: KeychainErrorCode,
    message?: string,
    options?: ErrorOptions,
  );
  constructor(message: string, code: KeychainErrorCode, options?: ErrorOptions);
  constructor(
    codeOrMessage: KeychainErrorCode | string,
    messageOrCode?: string | KeychainErrorCode,
    options?: ErrorOptions,
  ) {
    const isCode = (value: string): value is KeychainErrorCode =>
      [
        "NOT_FOUND",
        "BACKEND_UNAVAILABLE",
        "LOCKED",
        "DENIED",
        "TIMEOUT",
      ].includes(value);
    const code: KeychainErrorCode = isCode(codeOrMessage)
      ? codeOrMessage
      : isCode(String(messageOrCode))
        ? (String(messageOrCode) as KeychainErrorCode)
        : "BACKEND_UNAVAILABLE";
    const message = isCode(codeOrMessage)
      ? typeof messageOrCode === "string"
        ? messageOrCode
        : `Keychain operation failed: ${code}`
      : codeOrMessage;
    super(message, code, options);
    this.keychain_code = code;
  }
}
