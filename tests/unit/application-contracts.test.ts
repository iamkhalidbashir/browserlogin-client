import { describe, expect, test } from "vitest";
import { BrowserInitializationRequiredError } from "../../src/core/binary/index.js";
import { SetupRequiredError } from "../../src/core/config/connection.js";
import {
  applicationFailure,
  ApplicationOperationError,
  applicationSuccess,
  unwrapApplicationResult,
} from "../../src/core/app/contracts.js";

describe("application contracts", () => {
  test("normalizes expected errors without exposing unknown failure details", () => {
    const setup = applicationFailure(new SetupRequiredError());
    const binary = applicationFailure(new BrowserInitializationRequiredError());
    const internal = applicationFailure(new Error("bl_secret_value"));

    expect(setup).toEqual({
      ok: false,
      error: {
        code: "SETUP_REQUIRED",
        message: "BrowserLogin connection setup is required",
        retryable: false,
      },
    });
    expect(binary).toMatchObject({
      ok: false,
      error: { code: "BROWSER_INIT_REQUIRED", retryable: false },
    });
    expect(internal).toEqual({
      ok: false,
      error: {
        code: "INTERNAL",
        message: "BrowserLogin operation could not be completed.",
        retryable: false,
      },
    });
  });

  test("unwraps successful values and restores typed application errors", () => {
    expect(
      unwrapApplicationResult(applicationSuccess({ status: "ready" })),
    ).toEqual({
      status: "ready",
    });
    expect(() =>
      unwrapApplicationResult({
        ok: false,
        error: {
          code: "CONFIRMATION_REQUIRED",
          message: "confirmation mismatch",
          retryable: false,
        },
      }),
    ).toThrow(ApplicationOperationError);
  });
});
