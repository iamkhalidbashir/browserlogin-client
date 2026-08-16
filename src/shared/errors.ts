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
  readonly keychain_code: KeychainErrorCode;

  constructor(
    code: KeychainErrorCode,
    message = `Keychain operation failed: ${code}`,
    options?: ErrorOptions,
  ) {
    super(message, "KEYCHAIN_ERROR", options);
    this.keychain_code = code;
  }
}
