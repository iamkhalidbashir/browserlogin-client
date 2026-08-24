import type { AppRPCMethod } from "../../shared/rpc-schema.js";

export const APPLICATION_ERROR_CODES = [
  "SETUP_REQUIRED",
  "RECOVERY_PENDING",
  "CONFIRMATION_REQUIRED",
  "BROWSER_INIT_REQUIRED",
  "BROWSER_LICENSE_REQUIRED",
  "LICENSE_REQUIRED",
  "ADVANCED_CONFIRMATION_REQUIRED",
  "CUSTOM_URL_REQUIRED",
  "NOT_FOUND",
  "CONFLICT",
  "INVALID_INPUT",
  "CANCELLED",
  "UPSTREAM_UNAVAILABLE",
  "INTERNAL",
] as const;

export type ApplicationErrorCode = (typeof APPLICATION_ERROR_CODES)[number];

export type ApplicationError = {
  readonly code: ApplicationErrorCode;
  readonly message: string;
  readonly retryable: boolean;
};

export type ApplicationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ApplicationError };

export type ApplicationService = (
  params: unknown,
) => unknown | Promise<unknown>;

export type ApplicationServices = Partial<
  Record<AppRPCMethod, ApplicationService>
>;

const expectedCodes = new Set<string>(APPLICATION_ERROR_CODES);

function errorCode(error: Error): ApplicationErrorCode | undefined {
  if (!("code" in error) || typeof error.code !== "string") return undefined;
  if (!expectedCodes.has(error.code)) return undefined;
  return APPLICATION_ERROR_CODES.find((code) => code === error.code);
}

function retryable(code: ApplicationErrorCode): boolean {
  return code === "UPSTREAM_UNAVAILABLE";
}

export class ApplicationOperationError extends Error {
  readonly name = "ApplicationOperationError";

  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export function applicationSuccess<T>(value: T): ApplicationResult<T> {
  return { ok: true, value };
}

export function applicationFailure(error: unknown): ApplicationResult<never> {
  if (error instanceof ApplicationOperationError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    };
  }
  if (error instanceof TypeError) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: error.message,
        retryable: false,
      },
    };
  }
  if (error instanceof Error) {
    const code = errorCode(error);
    if (code) {
      return {
        ok: false,
        error: { code, message: error.message, retryable: retryable(code) },
      };
    }
  }
  return {
    ok: false,
    error: {
      code: "INTERNAL",
      message: "BrowserLogin operation could not be completed.",
      retryable: false,
    },
  };
}

export async function executeApplication<T>(
  operation: () => Promise<T>,
): Promise<ApplicationResult<T>> {
  try {
    return applicationSuccess(await operation());
  } catch (error) {
    return applicationFailure(error);
  }
}

export function unwrapApplicationResult<T>(result: ApplicationResult<T>): T {
  if (result.ok) return result.value;
  throw new ApplicationOperationError(
    result.error.code,
    result.error.message,
    result.error.retryable,
  );
}
